import { save } from './storage.js'
import { currentGoal, updateCurrentGoal } from '../core/store.js'
import { normalizeLayoutGoal } from '../core/layout.js'

export const appState = {
  store: null,
  goal: null,
  selectedId: null,
  selectedIds: new Set(),
  selectedEdge: null,
  editingId: null,
  editingIsNew: false,
  undoPast: [],
  undoFuture: [],
  pan: { x: 80, y: 0 },
  zoom: 1,
  layoutDirection: 'ltr',
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

function pruneSelection(goal) {
  const validNodeIds = new Set(goal.nodes.map(node => node.id))
  for (const id of appState.selectedIds) {
    if (!validNodeIds.has(id)) appState.selectedIds.delete(id)
  }
  if (appState.selectedId && !validNodeIds.has(appState.selectedId)) {
    appState.selectedId = appState.selectedIds.values().next().value ?? null
  }
  if (appState.selectedEdge &&
    !goal.edges.some(edge =>
      edge.from === appState.selectedEdge.from && edge.to === appState.selectedEdge.to)) {
    appState.selectedEdge = null
  }
}

function clearSelection() {
  appState.selectedId = null
  appState.selectedIds.clear()
  appState.selectedEdge = null
}

export function setGoal(goal, { history = true } = {}) {
  if (history && appState.goal && !sameGoal(appState.goal, goal)) pushUndo(appState.goal)
  appState.goal = goal
  appState.store = updateCurrentGoal(appState.store, goal)
  pruneSelection(goal)
  save(appState.store, appState)
  appState.renderFn()
}

export function undoGoal() {
  const previous = appState.undoPast.pop()
  if (!previous) return false
  appState.undoFuture.push(appState.goal)
  clearSelection()
  appState.editingId = null
  appState.editingIsNew = false
  setGoal(previous, { history: false })
  return true
}

export function redoGoal() {
  const next = appState.undoFuture.pop()
  if (!next) return false
  appState.undoPast.push(appState.goal)
  clearSelection()
  appState.editingId = null
  appState.editingIsNew = false
  setGoal(next, { history: false })
  return true
}

// Replace the whole store (goal switch, import, file adoption)
export function setStore(store, { persist = true } = {}) {
  appState.store = store
  appState.goal = currentGoal(store)
  clearSelection()
  appState.editingId = null
  appState.editingIsNew = false
  appState.undoPast = []
  appState.undoFuture = []
  appState.nodeHeights.clear()
  if (persist) save(store, appState)
  appState.renderFn()
}

export function storeWithCurrentLayoutOrder() {
  return {
    ...appState.store,
    goals: appState.store.goals.map(entry => {
      const options = entry.id === appState.store.currentId
        ? { positions: appState.lastPositions }
        : {}
      return {
        ...entry,
        goal: normalizeLayoutGoal(entry.goal, options)
      }
    })
  }
}

export function rerender() {
  appState.renderFn()
}

export function selectNode(id, { additive = false } = {}) {
  if (additive) {
    if (appState.selectedIds.has(id)) {
      appState.selectedIds.delete(id)
      appState.selectedId = appState.selectedId === id
        ? appState.selectedIds.values().next().value ?? null
        : appState.selectedId
    } else {
      appState.selectedIds.add(id)
      appState.selectedId = id
    }
    appState.selectedEdge = null
    appState.renderFn()
    return
  }
  if (appState.selectedId === id &&
    appState.selectedIds.size === 1 &&
    appState.selectedIds.has(id)) return // keep DOM intact so dblclick can land
  appState.selectedId = id
  appState.selectedIds = new Set([id])
  appState.selectedEdge = null
  appState.renderFn()
}

export function startEditing(id, isNew = false) {
  appState.selectedId = id
  appState.selectedIds = new Set([id])
  appState.selectedEdge = null
  appState.editingId = id
  appState.editingIsNew = isNew
  appState.renderFn()
}

export function stopEditing() {
  appState.editingId = null
  appState.editingIsNew = false
}
