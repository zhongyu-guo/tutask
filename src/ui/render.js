import { predecessorsOf, isReady, hiddenByCollapse, collapsedCount } from '../core/graph.js'
import { autoLayout, resolvePositions } from '../core/layout.js'
import { appState } from './state.js'

export const NODE_W = 210
export const NODE_H = 64
const GAP_X = 300
const GAP_Y = 104

const STATUS_LABEL = { todo: '待开始', doing: '进行中', done: '已完成' }

export function detailPanelHeight(goal, id) {
  const preds = predecessorsOf(goal, id)
  return 248 + preds.length * 26
}

function isOverdue(node) {
  if (!node.deadline || node.status === 'done') return false
  return new Date(node.deadline + 'T23:59:59') < new Date()
}

export function updateTransform() {
  const world = document.getElementById('world')
  world.style.transform =
    `translate(${appState.pan.x}px, ${appState.pan.y}px) scale(${appState.zoom})`
  document.getElementById('zoomLabel').textContent = Math.round(appState.zoom * 100) + '%'
}

// drawn from the successor back to its prerequisite: the arrowhead points
// toward the node being realized (i.e. toward the goal side of the graph)
function edgePath(from, to) {
  const x1 = to.x
  const y1 = to.y + NODE_H / 2
  const x2 = from.x + NODE_W + 9 // clear the connector dot so the head stays visible
  const y2 = from.y + NODE_H / 2
  const dx = Math.max(40, (x1 - x2) / 2)
  return `M ${x1} ${y1} C ${x1 - dx} ${y1}, ${x2 + dx} ${y2}, ${x2} ${y2}`
}

function renderEdges(svg, goal, positions, visible) {
  svg.innerHTML = `
    <defs>
      <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6"
              markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path d="M 0 0.5 L 11 6 L 0 11.5 L 3.5 6 z" fill="var(--edge)"></path>
      </marker>
    </defs>`
  for (const edge of goal.edges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (!from || !to) continue
    const d = edgePath(from, to)
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('class', 'edge')
    path.setAttribute('marker-end', 'url(#arrow)')
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    hit.setAttribute('d', d)
    hit.setAttribute('class', 'edge-hit')
    hit.dataset.from = edge.from
    hit.dataset.to = edge.to
    svg.appendChild(path)
    svg.appendChild(hit)
  }
}

function nodeClasses(goal, node) {
  const classes = ['node', node.type, node.status]
  if (isReady(goal, node.id)) classes.push('ready')
  if (node.id === appState.selectedId) classes.push('selected')
  if (isOverdue(node)) classes.push('overdue')
  return classes.join(' ')
}

function renderTitle(node) {
  if (appState.editingId === node.id) {
    return `<input class="title-input" data-id="${node.id}" value="">`
  }
  return `<div class="title"></div>`
}

function renderBadges(node) {
  let html = ''
  if (node.deadline) {
    html += `<span class="badge deadline${isOverdue(node) ? ' overdue' : ''}">📅 ${node.deadline}</span>`
  }
  if (node.estimatedHours) {
    html += `<span class="badge">⏱ ${node.estimatedHours}h</span>`
  }
  return html ? `<div class="badges">${html}</div>` : ''
}

function renderCollapseBtn(goal, node) {
  if (node.id === 'root') return ''
  const preds = predecessorsOf(goal, node.id)
  if (preds.length === 0) return ''
  if (node.collapsed) {
    const count = collapsedCount(goal, node.id)
    return `<button class="collapse-btn collapsed" data-id="${node.id}" title="展开前序步骤">◂${count}</button>`
  }
  return `<button class="collapse-btn" data-id="${node.id}" title="收起前序步骤">▾</button>`
}

function renderDetailPanel(goal, node) {
  if (!node.detailOpen) return ''
  const preds = predecessorsOf(goal, node.id)
  const predItems = preds.length === 0
    ? '<div class="prereq-empty">（无前序，可直接开始）</div>'
    : preds.map(p =>
        `<div class="prereq-item" data-target="${p.id}">
          <span class="dot ${p.status}"></span><span class="prereq-title"></span>
        </div>`).join('')
  return `
  <div class="detail-panel" data-id="${node.id}">
    <div class="detail-section"><div class="detail-label">前序步骤</div>${predItems}</div>
    <div class="detail-section">
      <div class="detail-label">详情</div>
      <textarea class="f-description" data-id="${node.id}" placeholder="任务描述…"></textarea>
      <div class="detail-row">
        <select class="f-status" data-id="${node.id}">
          ${['todo', 'doing', 'done'].map(s =>
            `<option value="${s}"${node.status === s ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
        </select>
        <input class="f-hours" data-id="${node.id}" type="number" min="0" step="0.5"
               placeholder="工时h" value="${node.estimatedHours ?? ''}">
      </div>
      <input class="f-deadline" data-id="${node.id}" type="date" value="${node.deadline ?? ''}">
    </div>
  </div>`
}

export function render() {
  const goal = appState.goal
  const hidden = hiddenByCollapse(goal)
  const visible = new Set(goal.nodes.filter(n => !hidden.has(n.id)).map(n => n.id))

  const detailHeights = {}
  for (const node of goal.nodes) {
    if (node.detailOpen && visible.has(node.id)) {
      detailHeights[node.id] = detailPanelHeight(goal, node.id)
    }
  }
  const auto = autoLayout(goal, visible, { gapX: GAP_X, gapY: GAP_Y, detailHeights })
  const positions = resolvePositions(goal, auto)
  appState.lastPositions = positions
  appState.lastVisible = visible

  renderEdges(document.getElementById('edges'), goal, positions, visible)

  const layer = document.getElementById('nodes')
  layer.innerHTML = ''
  for (const node of goal.nodes) {
    if (!visible.has(node.id)) continue
    const pos = positions.get(node.id)
    const el = document.createElement('div')
    el.className = nodeClasses(goal, node)
    el.dataset.id = node.id
    el.style.left = pos.x + 'px'
    el.style.top = pos.y + 'px'
    el.innerHTML = `
      ${renderCollapseBtn(goal, node)}
      <div class="card" data-id="${node.id}">
        ${renderTitle(node)}
        ${renderBadges(node)}
        <button class="detail-btn" data-id="${node.id}" title="任务详情 (D)">${node.detailOpen ? '⊖' : '⊕'}</button>
        <div class="connector" data-id="${node.id}" title="拖出连线建立依赖"></div>
      </div>
      ${renderDetailPanel(goal, node)}`
    // text fields are set via textContent/value to avoid HTML injection
    const titleEl = el.querySelector('.title')
    if (titleEl) titleEl.textContent = node.title || '（未命名）'
    const inputEl = el.querySelector('.title-input')
    if (inputEl) inputEl.value = node.title
    const descEl = el.querySelector('.f-description')
    if (descEl) descEl.value = node.description
    el.querySelectorAll('.prereq-item').forEach(item => {
      const pred = goal.nodes.find(n => n.id === item.dataset.target)
      item.querySelector('.prereq-title').textContent = pred ? pred.title : '?'
    })
    layer.appendChild(el)
  }

  const titleInput = document.getElementById('goalTitle')
  if (document.activeElement !== titleInput) titleInput.value = goal.title

  document.getElementById('storageWarning').hidden = !appState.storageBroken
  document.getElementById('undoImportBar').hidden = !appState.importBackupAvailable

  updateTransform()

  const editing = layer.querySelector('.title-input')
  if (editing) {
    editing.focus()
    editing.select()
  }
}

export function ensureVisible(id) {
  const pos = appState.lastPositions.get(id)
  if (!pos) return
  const canvas = document.getElementById('canvas')
  const rect = canvas.getBoundingClientRect()
  const sx = pos.x * appState.zoom + appState.pan.x
  const sy = pos.y * appState.zoom + appState.pan.y
  const margin = 40
  if (sx < margin) appState.pan.x += margin - sx
  if (sy < margin) appState.pan.y += margin - sy
  const right = sx + NODE_W * appState.zoom
  const bottom = sy + NODE_H * appState.zoom
  if (right > rect.width - margin) appState.pan.x -= right - (rect.width - margin)
  if (bottom > rect.height - margin) appState.pan.y -= bottom - (rect.height - margin)
  updateTransform()
}
