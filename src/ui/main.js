import { createGoal } from '../core/model.js'
import { appState } from './state.js'
import { render } from './render.js'
import { load } from './storage.js'
import { setupInteractions } from './interactions.js'

function boot() {
  appState.renderFn = render
  appState.goal = load() ?? createGoal('双击编辑目标名称')
  appState.pan = {
    x: 80,
    y: Math.round(document.getElementById('canvas').clientHeight / 2)
  }
  setupInteractions()
  render()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
