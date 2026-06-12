import { updateNode, updateEdge } from '../core/model.js'
import { appState, setGoal } from './state.js'

// Floating popup for editing fill / border colors. A single instance lives in
// <body>, so node re-renders never destroy it while it is open.
// Colors are a fixed swatch set (black/white/gray/red/yellow/blue/green):
// fills use soft tints so text stays readable, strokes use strong tones.

const FILL_SWATCHES = [
  { name: '白', value: '#ffffff' },
  { name: '灰', value: '#eef1f4' },
  { name: '红', value: '#fdeaea' },
  { name: '黄', value: '#fdf4d7' },
  { name: '蓝', value: '#e4eefe' },
  { name: '绿', value: '#e6f6ec' },
  { name: '黑', value: '#2b3038' }
]

const STROKE_SWATCHES = [
  { name: '黑', value: '#2b3038' },
  { name: '白', value: '#ffffff' },
  { name: '灰', value: '#9aa2ad' },
  { name: '红', value: '#dd4f4f' },
  { name: '黄', value: '#e8a93c' },
  { name: '蓝', value: '#3b82f6' },
  { name: '绿', value: '#34a853' }
]

let panel = null
let target = null // { kind: 'node', id } | { kind: 'edge', from, to }

function swatchButtons(group, swatches) {
  return swatches.map(s =>
    `<button class="sp-swatch" data-group="${group}" data-color="${s.value}"
       title="${s.name}" style="background:${s.value}"></button>`
  ).join('')
}

function ensurePanel() {
  if (panel) return panel
  panel = document.createElement('div')
  panel.id = 'stylePanel'
  panel.hidden = true
  panel.innerHTML = `
    <div class="sp-title"></div>
    <div class="sp-row sp-fill">
      <span class="sp-label">填充</span>
      <div class="sp-swatches">${swatchButtons('fill', FILL_SWATCHES)}</div>
    </div>
    <div class="sp-row sp-stroke">
      <span class="sp-label sp-stroke-label">边框</span>
      <div class="sp-swatches">${swatchButtons('stroke', STROKE_SWATCHES)}</div>
    </div>
    <div class="sp-actions">
      <button class="sp-reset">重置</button>
      <button class="sp-close">关闭</button>
    </div>`
  document.body.appendChild(panel)

  panel.addEventListener('click', e => {
    const btn = e.target.closest('.sp-swatch')
    if (!btn || !targetExists()) return
    const color = btn.dataset.color
    if (btn.dataset.group === 'fill') {
      setGoal(updateNode(appState.goal, target.id, { fill: color }))
    } else if (target.kind === 'node') {
      setGoal(updateNode(appState.goal, target.id, { stroke: color }))
    } else {
      setGoal(updateEdge(appState.goal, target.from, target.to, { color }))
    }
    syncSelection()
  })
  panel.querySelector('.sp-reset').addEventListener('click', () => {
    if (!targetExists()) return
    if (target.kind === 'node') {
      setGoal(updateNode(appState.goal, target.id, { fill: null, stroke: null }))
    } else {
      setGoal(updateEdge(appState.goal, target.from, target.to, { color: null }))
    }
    syncSelection()
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

// highlight the swatches matching the target's current custom colors
function syncSelection() {
  if (!target) return
  let fill = null
  let stroke = null
  if (target.kind === 'node') {
    const node = appState.goal.nodes.find(n => n.id === target.id)
    fill = node?.fill ?? null
    stroke = node?.stroke ?? null
  } else {
    const edge = appState.goal.edges.find(e => e.from === target.from && e.to === target.to)
    stroke = edge?.color ?? null
  }
  panel.querySelectorAll('.sp-swatch').forEach(btn => {
    const current = btn.dataset.group === 'fill' ? fill : stroke
    btn.classList.toggle('active',
      current !== null && btn.dataset.color.toLowerCase() === current.toLowerCase())
  })
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
  syncSelection()
}

export function openEdgeStylePanel(from, to, x, y) {
  target = { kind: 'edge', from, to }
  show(x, y, '连线样式', { withFill: false, strokeLabel: '线条' })
  syncSelection()
}

export function closeStylePanel() {
  if (panel) panel.hidden = true
  target = null
}
