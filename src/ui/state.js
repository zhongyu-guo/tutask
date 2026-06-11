import { save } from './storage.js'
import { currentGoal, updateCurrentGoal } from '../core/store.js'

export const appState = {
  store: null,
  goal: null,
  selectedId: null,
  editingId: null,
  editingIsNew: false,
  pan: { x: 80, y: 0 },
  zoom: 1,
  dragEdgeFrom: null,
  storageBroken: false,
  fileReconnect: null, // async fn when a saved file binding awaits a user gesture
  // caches written by render() for keyboard navigation
  lastPositions: new Map(),
  lastVisible: new Set(),
  renderFn: null
}

export function setGoal(goal) {
  appState.goal = goal
  appState.store = updateCurrentGoal(appState.store, goal)
  save(appState.store, appState)
  appState.renderFn()
}

// Replace the whole store (goal switch, import, file adoption)
export function setStore(store, { persist = true } = {}) {
  appState.store = store
  appState.goal = currentGoal(store)
  appState.selectedId = null
  appState.editingId = null
  appState.editingIsNew = false
  if (persist) save(store, appState)
  appState.renderFn()
}

export function rerender() {
  appState.renderFn()
}

export function selectNode(id) {
  if (appState.selectedId === id) return // keep DOM intact so dblclick can land
  appState.selectedId = id
  appState.renderFn()
}

export function startEditing(id, isNew = false) {
  appState.selectedId = id
  appState.editingId = id
  appState.editingIsNew = isNew
  appState.renderFn()
}

export function stopEditing() {
  appState.editingId = null
  appState.editingIsNew = false
}
