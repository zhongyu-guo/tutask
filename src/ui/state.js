import { save } from './storage.js'

export const appState = {
  goal: null,
  selectedId: null,
  editingId: null,
  editingIsNew: false,
  pan: { x: 80, y: 0 },
  zoom: 1,
  dragEdgeFrom: null,
  storageBroken: false,
  importBackupAvailable: false,
  // caches written by render() for keyboard navigation
  lastPositions: new Map(),
  lastVisible: new Set(),
  renderFn: null
}

export function setGoal(goal) {
  appState.goal = goal
  save(goal, appState)
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
