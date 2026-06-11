import { updateNode, updateEdge } from '../core/model.js'
import { appState, setGoal } from './state.js'

// Floating popup for editing fill / border colors. A single instance lives in
// <body>, so node re-renders never destroy it while it is open.

let panel = null
let target = null // { kind: 'node', id } | { kind: 'edge', from, to }

function rgbToHex(rgb) {
  const m = rgb.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (!m) return '#ffffff'
  return '#' + [m[1], m[2], m[3]]
    .map(v => Number(v).toString(16).padStart(2, '0')).join('')
}

function ensurePanel() {
  if (panel) return panel
  panel = document.createElement('div')
  panel.id = 'stylePanel'
  panel.hidden = true
  panel.innerHTML = `
    <div class="sp-title"></div>
    <label class="sp-row sp-fill">填充 <input type="color" class="sp-fill-input"></label>
    <label class="sp-row sp-stroke"><span class="sp-stroke-label">边框</span> <input type="color" class="sp-stroke-input"></label>
    <div class="sp-actions">
      <button class="sp-reset">重置</button>
      <button class="sp-close">关闭</button>
    </div>`
  document.body.appendChild(panel)

  panel.querySelector('.sp-fill-input').addEventListener('input', e => {
    if (targetExists() && target.kind === 'node') {
      setGoal(updateNode(appState.goal, target.id, { fill: e.target.value }))
    }
  })
  panel.querySelector('.sp-stroke-input').addEventListener('input', e => {
    if (!targetExists()) return
    if (target.kind === 'node') {
      setGoal(updateNode(appState.goal, target.id, { stroke: e.target.value }))
    } else {
      setGoal(updateEdge(appState.goal, target.from, target.to, { color: e.target.value }))
    }
  })
  panel.querySelector('.sp-reset').addEventListener('click', () => {
    if (!targetExists()) return
    if (target.kind === 'node') {
      setGoal(updateNode(appState.goal, target.id, { fill: null, stroke: null }))
      syncInputsFromNode(target.id)
    } else {
      setGoal(updateEdge(appState.goal, target.from, target.to, { color: null }))
      syncInputsFromEdge()
    }
  })
  panel.querySelector('.sp-close').addEventListener('click', closeStylePanel)

  document.addEventListener('mousedown', e => {
    if (!panel.hidden && !panel.contains(e.target)) closeStylePanel()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) closeStylePanel()
  })
  return panel
}

// the target may vanish while the panel is open (node/edge deleted elsewhere)
function targetExists() {
  if (!target) return false
  const exists = target.kind === 'node'
    ? appState.goal.nodes.some(n => n.id === target.id)
    : appState.goal.edges.some(e => e.from === target.from && e.to === target.to)
  if (!exists) closeStylePanel()
  return exists
}

function syncInputsFromNode(id) {
  const card = document.querySelector(`.node[data-id="${id}"] .card`)
  if (!card) return
  const cs = getComputedStyle(card)
  panel.querySelector('.sp-fill-input').value = rgbToHex(cs.backgroundColor)
  panel.querySelector('.sp-stroke-input').value = rgbToHex(cs.borderTopColor)
}

function syncInputsFromEdge() {
  const edge = appState.goal.edges.find(e => e.from === target.from && e.to === target.to)
  const fallback = getComputedStyle(document.documentElement).getPropertyValue('--edge').trim()
  panel.querySelector('.sp-stroke-input').value = edge?.color ?? (fallback || '#5f6b7c')
}

function show(x, y, title, { withFill, strokeLabel }) {
  const p = ensurePanel()
  p.querySelector('.sp-title').textContent = title
  p.querySelector('.sp-fill').hidden = !withFill
  p.querySelector('.sp-stroke-label').textContent = strokeLabel
  p.hidden = false
  const margin = 8
  const w = p.offsetWidth
  const h = p.offsetHeight
  p.style.left = Math.min(x + 10, window.innerWidth - w - margin) + 'px'
  p.style.top = Math.min(y + 10, window.innerHeight - h - margin) + 'px'
}

export function openNodeStylePanel(id, x, y) {
  const node = appState.goal.nodes.find(n => n.id === id)
  if (!node) return
  target = { kind: 'node', id }
  show(x, y, node.title || '（未命名）', { withFill: true, strokeLabel: '边框' })
  syncInputsFromNode(id)
}

export function openEdgeStylePanel(from, to, x, y) {
  target = { kind: 'edge', from, to }
  show(x, y, '连线样式', { withFill: false, strokeLabel: '线条' })
  syncInputsFromEdge()
}

export function closeStylePanel() {
  if (panel) panel.hidden = true
  target = null
}
