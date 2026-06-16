import { genId, updateNode } from './model.js'
import { validateGoal } from './serialize.js'
import { STORE_VERSION, normalizeGoal, normalizeStore } from './schema.js'

export function createStore(goal) {
  const id = genId()
  return { version: STORE_VERSION, currentId: id, goals: [{ id, goal: normalizeGoal(goal) }] }
}

export function migrateStore(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  if (raw.version === STORE_VERSION) {
    const normalized = normalizeStore(raw)
    if (!Array.isArray(normalized.goals) || normalized.goals.length === 0) return null
    const ids = new Set()
    const allValid = normalized.goals.every(entry => {
      if (!entry || typeof entry.id !== 'string' || ids.has(entry.id)) return false
      ids.add(entry.id)
      return validateGoal(entry.goal).valid
    })
    if (!allValid) return null
    const currentOk = normalized.goals.some(entry => entry.id === normalized.currentId)
    return currentOk ? normalized : { ...normalized, currentId: normalized.goals[0].id }
  }
  // legacy v1: a bare goal object
  const goal = normalizeGoal(raw)
  if (validateGoal(goal).valid) return createStore(goal)
  return null
}

export function validateStore(raw) {
  const store = migrateStore(raw)
  return {
    valid: store !== null,
    store
  }
}

function findEntry(store, id) {
  const entry = store.goals.find(e => e.id === id)
  if (!entry) throw new Error(`Goal not found: ${id}`)
  return entry
}

export function currentGoal(store) {
  return findEntry(store, store.currentId).goal
}

export function updateCurrentGoal(store, goal) {
  const normalized = normalizeGoal(goal)
  return {
    ...store,
    goals: store.goals.map(e => (e.id === store.currentId ? { ...e, goal: normalized } : e))
  }
}

export function addGoal(store, goal) {
  const id = genId()
  return { ...store, currentId: id, goals: [...store.goals, { id, goal: normalizeGoal(goal) }] }
}

export function switchGoal(store, id) {
  findEntry(store, id)
  return { ...store, currentId: id }
}

export function removeGoal(store, id) {
  findEntry(store, id)
  if (store.goals.length === 1) throw new Error('Cannot remove the last goal')
  const goals = store.goals.filter(e => e.id !== id)
  const currentId = store.currentId === id ? goals[0].id : store.currentId
  return { ...store, currentId, goals }
}

export function renameCurrentGoal(store, title) {
  const goal = currentGoal(store)
  const renamed = { ...updateNode(goal, 'root', { title }), title }
  return updateCurrentGoal(store, renamed)
}
