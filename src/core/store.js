import { genId, updateNode } from './model.js'
import { validateGoal } from './serialize.js'

export function createStore(goal) {
  const id = genId()
  return { version: 2, currentId: id, goals: [{ id, goal }] }
}

export function migrateStore(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  if (raw.version === 2) {
    if (!Array.isArray(raw.goals) || raw.goals.length === 0) return null
    const allValid = raw.goals.every(entry =>
      entry && typeof entry.id === 'string' && validateGoal(entry.goal).valid)
    if (!allValid) return null
    const currentOk = raw.goals.some(entry => entry.id === raw.currentId)
    return currentOk ? raw : { ...raw, currentId: raw.goals[0].id }
  }
  // legacy v1: a bare goal object
  if (validateGoal(raw).valid) return createStore(raw)
  return null
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
  return {
    ...store,
    goals: store.goals.map(e => (e.id === store.currentId ? { ...e, goal } : e))
  }
}

export function addGoal(store, goal) {
  const id = genId()
  return { ...store, currentId: id, goals: [...store.goals, { id, goal }] }
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
