import { save } from './storage.js'
import { currentGoal, updateCurrentGoal } from '../core/store.js'

export const appState = {
  store: null,
  goal: null,
  selectedId: null,
  selectedEdge: null,
  editingId: null,
  editingIsNew: false,
  undoPast: [],
  undoFuture: [],
  pan: { x: 80, y: 0 },
  zoom: 1,
  dragEdgeFrom: null,
  storageBroken: false,
  fileReconnect: null, // async fn when a saved file binding awaits a user gesture
  // caches written by render() for keyboard navigation
  lastPositions: new Map(),
  lastVisible: new Set(),
  nodeHeights: new Map(),
  renderFn: null
}

const HISTORY_LIMIT = 100

function sameGoal(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

function pushUndo(goal) {
  appState.undoPast.push(goal)
  if (appState.undoPast.length > HISTORY_LIMIT) appState.undoPast.shift()
  appState.undoFuture = []
}

export function setGoal(goal, { history = true } = {}) {
  if (history && appState.goal && !sameGoal(appState.goal, goal)) pushUndo(appState.goal)
  appState.goal = goal
  appState.store = updateCurrentGoal(appState.store, goal)
  save(appState.store, appState)
  appState.renderFn()
}

export function undoGoal() {
  const previous = appState.undoPast.pop()
  if (!previous) return false
  appState.undoFuture.push(appState.goal)
  appState.selectedId = null
  appState.selectedEdge = null
  appState.editingId = null
  appState.editingIsNew = false
  setGoal(previous, { history: false })
  return true
}

export function redoGoal() {
  const next = appState.undoFuture.pop()
  if (!next) return false
  appState.undoPast.push(appState.goal)
  appState.selectedId = null
  appState.selectedEdge = null
  appState.editingId = null
  appState.editingIsNew = false
  setGoal(next, { history: false })
  return true
}

// Replace the whole store (goal switch, import, file adoption)
export function setStore(store, { persist = true } = {}) {
  appState.store = store
  appState.goal = currentGoal(store)
  appState.selectedId = null
  appState.selectedEdge = null
  appState.editingId = null
  appState.editingIsNew = false
  appState.undoPast = []
  appState.undoFuture = []
  appState.nodeHeights.clear()
  if (persist) save(store, appState)
  appState.renderFn()
}

export function rerender() {
  appState.renderFn()
}

export function selectNode(id) {
  if (appState.selectedId === id) return // keep DOM intact so dblclick can land
  appState.selectedId = id
  appState.selectedEdge = null
  appState.renderFn()
}

export function startEditing(id, isNew = false) {
  appState.selectedId = id
  appState.selectedEdge = null
  appState.editingId = id
  appState.editingIsNew = isNew
  appState.renderFn()
}

export function stopEditing() {
  appState.editingId = null
  appState.editingIsNew = false
}
