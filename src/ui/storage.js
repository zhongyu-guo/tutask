import { migrateStore } from '../core/store.js'

const KEY = 'taskdag-store'
const LEGACY_KEY = 'taskdag-goal'
const IDB_NAME = 'taskdag'
const IDB_STORE = 'kv'
const HANDLE_KEY = 'fileHandle'
const FILE_WRITE_DELAY = 400

const fileSync = {
  handle: null,
  lastModified: 0,
  writeTimer: null,
  onExternalChange: null, // set by main.js: (store) => void
  onStatusChange: null // set by main.js: () => void
}

export function fileBound() {
  return fileSync.handle !== null
}

export function boundFileName() {
  return fileSync.handle ? fileSync.handle.name : ''
}

export function fileApiAvailable() {
  return typeof window.showOpenFilePicker === 'function'
}

// ---------- localStorage ----------

export function save(store, appState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
    appState.storageBroken = false
  } catch (error) {
    appState.storageBroken = true
  }
  scheduleFileWrite(store)
}

export function load() {
  try {
    const text = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (!text) return null
    return migrateStore(JSON.parse(text))
  } catch (error) {
    return null
  }
}

// ---------- IndexedDB (file handle persistence) ----------

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

// ---------- data file sync ----------

async function readStoreFromFile() {
  const file = await fileSync.handle.getFile()
  fileSync.lastModified = file.lastModified
  const text = await file.text()
  if (text.trim() === '') return null
  return migrateStore(JSON.parse(text))
}

async function writeStoreToFile(store) {
  const writable = await fileSync.handle.createWritable()
  await writable.write(JSON.stringify(store, null, 2))
  await writable.close()
  const file = await fileSync.handle.getFile()
  fileSync.lastModified = file.lastModified
}

function scheduleFileWrite(store) {
  if (!fileSync.handle) return
  clearTimeout(fileSync.writeTimer)
  fileSync.writeTimer = setTimeout(() => {
    writeStoreToFile(store).catch(() => {
      // lost permission or file gone — drop the binding so the UI reflects it
      unbindFile()
    })
  }, FILE_WRITE_DELAY)
}

// Bind a data file. pickExisting=true opens an existing file (its content wins
// if valid); otherwise creates a new file seeded with the current store.
export async function bindFile(currentStore, pickExisting) {
  let handle
  if (pickExisting) {
    const [picked] = await window.showOpenFilePicker({
      types: [{ description: 'Task DAG 数据', accept: { 'application/json': ['.json'] } }]
    })
    handle = picked
  } else {
    handle = await window.showSaveFilePicker({
      suggestedName: 'taskdag-data.json',
      types: [{ description: 'Task DAG 数据', accept: { 'application/json': ['.json'] } }]
    })
  }
  const permission = await handle.requestPermission({ mode: 'readwrite' })
  if (permission !== 'granted') throw new Error('未授予文件读写权限')
  fileSync.handle = handle
  await idbSet(HANDLE_KEY, handle)
  let adopted = null
  if (pickExisting) {
    adopted = await readStoreFromFile()
    if (!adopted) await writeStoreToFile(currentStore) // empty/new file: seed it
  } else {
    await writeStoreToFile(currentStore)
  }
  fileSync.onStatusChange?.()
  return adopted
}

export async function unbindFile() {
  fileSync.handle = null
  clearTimeout(fileSync.writeTimer)
  await idbDel(HANDLE_KEY).catch(() => {})
  fileSync.onStatusChange?.()
}

// On startup: try to restore the saved handle. Returns:
//   {status:'none'} | {status:'granted', store} | {status:'prompt', resume}
export async function restoreFileBinding() {
  if (!fileApiAvailable()) return { status: 'none' }
  const handle = await idbGet(HANDLE_KEY).catch(() => null)
  if (!handle) return { status: 'none' }
  const connect = async () => {
    fileSync.handle = handle
    const store = await readStoreFromFile()
    fileSync.onStatusChange?.()
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
      if (granted !== 'granted') throw new Error('未授予文件读写权限')
      return connect()
    }
  }
}

// Re-read the file when the tab regains focus and another instance changed it.
export function watchExternalChanges() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !fileSync.handle) return
    try {
      const file = await fileSync.handle.getFile()
      if (file.lastModified <= fileSync.lastModified) return
      const store = await readStoreFromFile()
      if (store) fileSync.onExternalChange?.(store)
    } catch (error) {
      // ignore transient read errors; next focus will retry
    }
  })
}

export function setFileSyncCallbacks({ onExternalChange, onStatusChange }) {
  fileSync.onExternalChange = onExternalChange
  fileSync.onStatusChange = onStatusChange
}
