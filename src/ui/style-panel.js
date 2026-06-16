import { updateNode, updateEdge } from '../core/model.js'
import { appState, setGoal } from './state.js'

// Floating popup: task details (description / status / hours / deadline) for
// nodes, line color for edges. A single instance lives in <body> above nodes
// and edges, so re-renders never destroy it. Node appearance follows status;
// only edges get a color choice, from a fixed swatch set.

const STROKE_SWATCHES = [
  { name: '黑', value: '#2b3038' },
  { name: '白', value: '#ffffff' },
  { name: '灰', value: '#9aa2ad' },
  { name: '红', value: '#dd4f4f' },
  { name: '黄', value: '#e8a93c' },
  { name: '蓝', value: '#3b82f6' },
  { name: '绿', value: '#34a853' }
]

const STATUS_LABEL = { todo: '未开始', doing: '正在执行', done: '已完成' }
const CHAIN_STATUS_LABEL = { active: '链条：进行中', paused: '链条：挂起' }

let panel = null
let target = null // { kind: 'node', id } | { kind: 'edge', from, to }
let titleComposing = false
let ignoreNextTitleEnter = false

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
    <input class="sp-title" aria-label="节点名称" placeholder="节点名称">
    <div class="sp-detail">
      <div class="sp-section">
        <textarea class="f-description" placeholder="任务描述…"></textarea>
        <div class="sp-field-row">
          <select class="f-chain-status">
            ${['active', 'paused'].map(s =>
              `<option value="${s}">${CHAIN_STATUS_LABEL[s]}</option>`).join('')}
          </select>
          <select class="f-status">
            ${['todo', 'doing', 'done'].map(s =>
              `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}
          </select>
          <input class="f-hours" type="number" min="0" step="0.5" placeholder="工时h">
        </div>
        <input class="f-deadline" type="date">
      </div>
    </div>
    <div class="sp-row sp-stroke">
      <span class="sp-label">线条</span>
      <div class="sp-swatches">${swatchButtons('stroke', STROKE_SWATCHES)}</div>
    </div>
    <div class="sp-actions">
      <button class="sp-reset">重置颜色</button>
    </div>`
  document.body.appendChild(panel)

  panel.addEventListener('click', e => {
    const btn = e.target.closest('.sp-swatch')
    if (!btn || !targetExists() || target.kind !== 'edge') return
    setGoal(updateEdge(appState.goal, target.from, target.to, { color: btn.dataset.color }))
    syncSelection()
  })

  panel.addEventListener('change', e => {
    if (!targetExists() || target.kind !== 'node') return
    const id = target.id
    if (e.target.classList.contains('sp-title')) {
      updateNodeTitle(id, e.target.value)
    } else if (e.target.classList.contains('f-description')) {
      setGoal(updateNode(appState.goal, id, { description: e.target.value }))
    } else if (e.target.classList.contains('f-status')) {
      setGoal(updateNode(appState.goal, id, { status: e.target.value }))
    } else if (e.target.classList.contains('f-chain-status')) {
      setGoal(updateNode(appState.goal, id, { chainStatus: e.target.value }))
    } else if (e.target.classList.contains('f-hours')) {
      const value = e.target.value === '' ? null : Number(e.target.value)
      setGoal(updateNode(appState.goal, id, { estimatedHours: value }))
    } else if (e.target.classList.contains('f-deadline')) {
      setGoal(updateNode(appState.goal, id, { deadline: e.target.value || null }))
    }
  })

  panel.addEventListener('input', e => {
    if (!targetExists() || target.kind !== 'node') return
    if (e.target.classList.contains('sp-title') && !titleComposing) {
      updateNodeTitle(target.id, e.target.value)
    }
  })

  panel.addEventListener('compositionstart', e => {
    if (e.target.classList.contains('sp-title')) titleComposing = true
  })

  panel.addEventListener('compositionend', e => {
    if (!e.target.classList.contains('sp-title')) return
    titleComposing = false
    ignoreNextTitleEnter = true
    setTimeout(() => { ignoreNextTitleEnter = false }, 250)
    if (targetExists() && target.kind === 'node') updateNodeTitle(target.id, e.target.value)
  })

  panel.addEventListener('keydown', e => {
    if (e.target.classList.contains('sp-title') && e.key === 'Enter') {
      if (titleComposing || ignoreNextTitleEnter || e.isComposing || e.keyCode === 229) {
        ignoreNextTitleEnter = false
        return
      }
      e.preventDefault()
      e.target.blur()
    }
  })

  panel.querySelector('.sp-reset').addEventListener('click', () => {
    if (!targetExists() || target.kind !== 'edge') return
    setGoal(updateEdge(appState.goal, target.from, target.to, { color: null }))
    syncSelection()
  })

  document.addEventListener('mousedown', e => {
    if (!panel.hidden && !panel.contains(e.target)) closeStylePanel()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.hidden) closeStylePanel()
  })
  return panel
}

function updateNodeTitle(id, value) {
  const title = value.trim()
  let next = updateNode(appState.goal, id, { title })
  if (id === 'root') next = { ...next, title }
  setGoal(next)
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

// highlight the swatch matching the edge's current custom color
function syncSelection() {
  if (!target || target.kind !== 'edge') return
  const edge = appState.goal.edges.find(e => e.from === target.from && e.to === target.to)
  const stroke = edge?.color ?? null
  panel.querySelectorAll('.sp-swatch').forEach(btn => {
    btn.classList.toggle('active',
      stroke !== null && btn.dataset.color.toLowerCase() === stroke.toLowerCase())
  })
}

function syncFields(node) {
  panel.querySelector('.sp-title').value = node.title ?? ''
  panel.querySelector('.f-description').value = node.description ?? ''
  panel.querySelector('.f-chain-status').value = node.chainStatus ?? 'active'
  panel.querySelector('.f-status').value = node.status
  panel.querySelector('.f-hours').value = node.estimatedHours ?? ''
  panel.querySelector('.f-deadline').value = node.deadline ?? ''
}

function show(x, y, title, { isNode }) {
  const p = ensurePanel()
  const titleInput = p.querySelector('.sp-title')
  titleInput.hidden = !isNode
  titleInput.value = title
  p.querySelector('.sp-detail').hidden = !isNode
  p.querySelector('.sp-stroke').hidden = isNode
  p.querySelector('.sp-reset').hidden = isNode
  p.querySelector('.sp-actions').hidden = isNode
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
  show(x, y, node.title || '（未命名）', { isNode: true })
  syncFields(node)
}

export function openEdgeStylePanel(from, to, x, y) {
  target = { kind: 'edge', from, to }
  show(x, y, '连线样式', { isNode: false })
  syncSelection()
}

export function closeStylePanel() {
  if (panel) panel.hidden = true
  target = null
}
