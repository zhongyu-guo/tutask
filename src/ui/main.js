import { createGoal } from '../core/model.js'
import { createStore, currentGoal } from '../core/store.js'
import { appState, setStore, rerender } from './state.js'
import { render } from './render.js'
import {
  load, save, restoreFileBinding, watchExternalChanges, setFileSyncCallbacks
} from './storage.js'
import { setupInteractions } from './interactions.js'

async function initFileSync() {
  setFileSyncCallbacks({
    onExternalChange: store => {
      if (appState.editingId) return // don't clobber an in-flight edit
      setStore(store)
    },
    onStatusChange: rerender
  })
  watchExternalChanges(() => appState.store.currentId)
  try {
    const result = await restoreFileBinding(appState.store)
    if (result.status === 'granted' && result.store) {
      setStore(result.store)
    } else if (result.status === 'prompt') {
      appState.fileReconnect = result.resume
      rerender()
    }
  } catch (error) {
    // binding restore is best-effort; localStorage data is already on screen
  }
}

function boot() {
  appState.renderFn = render
  const store = load() ?? createStore(createGoal('双击编辑目标名称'))
  appState.store = store
  appState.goal = currentGoal(store)
  save(store, appState) // persist immediately so legacy-format data is migrated once
  appState.pan = {
    x: 80,
    y: Math.round(document.getElementById('canvas').clientHeight / 2)
  }
  setupInteractions()
  render()
  initFileSync()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
