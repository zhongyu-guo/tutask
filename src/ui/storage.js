import { migrateStore } from '../core/store.js'
import { validateGoal } from '../core/serialize.js'
import { normalizeLayoutGoal } from '../core/layout.js'

const KEY = 'taskdag-store'
const LEGACY_KEY = 'taskdag-goal'
const IDB_NAME = 'taskdag'
const IDB_STORE = 'kv'
const HANDLE_KEY = 'dirHandle'
const DIR_WRITE_DELAY = 400

const dirSync = {
  handle: null,
  fingerprint: '', // names + lastModified of last scan, to detect external edits
  writtenText: new Map(), // filename → last text we wrote (skip no-op writes)
  writeTimer: null,
  onExternalChange: null, // set by main.js: (store) => void
  onStatusChange: null // set by main.js: () => void
}

export function fileBound() {
  return dirSync.handle !== null
}

export function boundFileName() {
  return dirSync.handle ? dirSync.handle.name + '/' : ''
}

export function fileApiAvailable() {
  return typeof window.showDirectoryPicker === 'function'
}

// ---------- localStorage (cache + unbound mode) ----------

export function save(store, appState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
    appState.storageBroken = false
  } catch (error) {
    appState.storageBroken = true
  }
  scheduleDirWrite(store)
}

export function load() {
  try {
    const text = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (!text) return null
    const store = migrateStore(JSON.parse(text))
    return store ? normalizeStoreLayout(store) : null
  } catch (error) {
    return null
  }
}

function normalizeStoreLayout(store, referenceStore = null) {
  const refs = new Map((referenceStore?.goals ?? []).map(entry => [entry.id, entry.goal]))
  return {
    ...store,
    goals: store.goals.map(entry => ({
      ...entry,
      goal: normalizeLayoutGoal(entry.goal, { referenceGoal: refs.get(entry.id) })
    }))
  }
}

// ---------- IndexedDB (directory handle persistence) ----------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbSet(key, value) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbGet(key) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbDel(key) {
  const db = await idbOpen()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------- goals directory sync (one <goalId>.json per goal) ----------

async function scanDir() {
  const entries = []
  const stamps = []
  for await (const handle of dirSync.handle.values()) {
    if (handle.kind !== 'file' || !handle.name.endsWith('.json')) continue
    const file = await handle.getFile()
    stamps.push(handle.name + ':' + file.lastModified)
    try {
      const goal = JSON.parse(await file.text())
      if (validateGoal(goal).valid) {
        entries.push({ id: handle.name.slice(0, -5), goal: normalizeLayoutGoal(goal) })
        dirSync.writtenText.set(handle.name, JSON.stringify(goal, null, 2))
      }
    } catch (error) {
      // skip unreadable/invalid files; they are left untouched on write
    }
  }
  dirSync.fingerprint = stamps.sort().join('|')
  return entries
}

function storeFromEntries(entries, preferredCurrentId) {
  if (entries.length === 0) return null
  const currentId = entries.some(e => e.id === preferredCurrentId)
    ? preferredCurrentId : entries[0].id
  return { version: 2, currentId, goals: entries }
}

async function writeStoreToDir(store) {
  const keep = new Set()
  for (const entry of store.goals) {
    const name = entry.id + '.json'
    keep.add(name)
    const text = JSON.stringify(entry.goal, null, 2)
    if (dirSync.writtenText.get(name) === text) continue
    const fileHandle = await dirSync.handle.getFileHandle(name, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(text)
    await writable.close()
    dirSync.writtenText.set(name, text)
  }
  // remove files for goals deleted in the app (only ones we know as valid goals)
  for (const name of [...dirSync.writtenText.keys()]) {
    if (!keep.has(name)) {
      await dirSync.handle.removeEntry(name).catch(() => {})
      dirSync.writtenText.delete(name)
    }
  }
  // refresh fingerprint so our own writes aren't seen as external changes
  await scanDir()
}

function scheduleDirWrite(store) {
  if (!dirSync.handle) return
  clearTimeout(dirSync.writeTimer)
  dirSync.writeTimer = setTimeout(() => {
    writeStoreToDir(store).catch(() => {
      unbindFile() // lost permission or directory gone
    })
  }, DIR_WRITE_DELAY)
}

// Bind the goals directory. Directory content wins by id; goals that exist
// only locally are written into the directory (union merge).
export async function bindFile(currentStore) {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  const permission = await handle.requestPermission({ mode: 'readwrite' })
  if (permission !== 'granted') throw new Error('未授予目录读写权限')
  dirSync.handle = handle
  await idbSet(HANDLE_KEY, handle)
  const merged = await adoptDir(currentStore)
  dirSync.onStatusChange?.()
  return merged
}

async function adoptDir(currentStore) {
  const entries = await scanDir()
  const current = normalizeStoreLayout(currentStore)
  const currentById = new Map(current.goals.map(e => [e.id, e]))
  const byId = new Map(entries.map(e => [
    e.id,
    {
      ...e,
      goal: normalizeLayoutGoal(e.goal, { referenceGoal: currentById.get(e.id)?.goal })
    }
  ]))
  for (const local of current.goals) {
    if (!byId.has(local.id)) byId.set(local.id, local)
  }
  const merged = storeFromEntries([...byId.values()], current.currentId)
  await writeStoreToDir(merged)
  return merged
}

export async function unbindFile() {
  dirSync.handle = null
  clearTimeout(dirSync.writeTimer)
  dirSync.writtenText.clear()
  await idbDel(HANDLE_KEY).catch(() => {})
  dirSync.onStatusChange?.()
}

// On startup: try to restore the saved directory handle. Returns:
//   {status:'none'} | {status:'granted', store} | {status:'prompt', resume}
export async function restoreFileBinding(currentStoreOrFactory) {
  if (!fileApiAvailable()) return { status: 'none' }
  const handle = await idbGet(HANDLE_KEY).catch(() => null)
  if (!handle) return { status: 'none' }
  const currentStore = () => typeof currentStoreOrFactory === 'function'
    ? currentStoreOrFactory()
    : currentStoreOrFactory
  const connect = async () => {
    dirSync.handle = handle
    const store = await adoptDir(currentStore())
    dirSync.onStatusChange?.()
    return store
  }
  const permission = await handle.queryPermission({ mode: 'readwrite' })
  if (permission === 'granted') {
    return { status: 'granted', store: await connect() }
  }
  return {
    status: 'prompt',
    resume: async () => {
      const granted = await handle.requestPermission({ mode: 'readwrite' })
      if (granted !== 'granted') throw new Error('未授予目录读写权限')
      return connect()
    }
  }
}

// Re-scan the directory when the tab regains focus and another instance changed it.
export function watchExternalChanges(getCurrentId) {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !dirSync.handle) return
    try {
      const before = dirSync.fingerprint
      const entries = await scanDir()
      if (dirSync.fingerprint === before) return
      const store = storeFromEntries(entries, getCurrentId())
      if (store) dirSync.onExternalChange?.(store)
    } catch (error) {
      // ignore transient read errors; next focus will retry
    }
  })
}

export function setFileSyncCallbacks({ onExternalChange, onStatusChange }) {
  dirSync.onExternalChange = onExternalChange
  dirSync.onStatusChange = onStatusChange
}
