import { predecessorsOf, isReady, hiddenByCollapse, collapsedCount } from '../core/graph.js'
import { autoLayout, resolvePositions } from '../core/layout.js'
import { appState } from './state.js'
import { fileBound, boundFileName, fileApiAvailable } from './storage.js'

export const NODE_W = 210
export const NODE_H = 64
const GAP_X = 300
const GAP_Y = 104

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

function edgePath(from, to, fromHeight = NODE_H, toHeight = NODE_H) {
  const source = from
  const target = to
  const sourceHeight = fromHeight
  const targetHeight = toHeight
  const targetOnRight = target.x + NODE_W / 2 >= source.x + NODE_W / 2
  const dir = targetOnRight ? 1 : -1
  const x1 = targetOnRight ? source.x + NODE_W + 9 : source.x - 9
  const y1 = source.y + sourceHeight / 2
  const x2 = targetOnRight ? target.x : target.x + NODE_W
  const y2 = target.y + targetHeight / 2
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dir * dx} ${y1}, ${x2 - dir * dx} ${y2}, ${x2} ${y2}`
}

export function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value)
}

function arrowMarker(id, fill) {
  return `
      <marker id="${id}" viewBox="0 0 12 12" refX="10" refY="6"
              markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path d="M 0 0.5 L 11 6 L 0 11.5 L 3.5 6 z" fill="${fill}"></path>
      </marker>`
}

function nodeHeight(id) {
  return appState.nodeHeights.get(id) ?? NODE_H
}

function renderEdges(svg, goal, positions, visible) {
  // one extra arrowhead marker per custom edge color, so heads match their line
  // (colors go into innerHTML, so only hex values from the color picker are accepted)
  const customColors = [...new Set(
    goal.edges.map(e => e.color).filter(c => isHexColor(c)))]
  const markerId = new Map(customColors.map((c, i) => [c, `arrow-c${i}`]))
  svg.innerHTML = `
    <defs>
      ${arrowMarker('arrow', 'var(--edge)')}
      ${customColors.map(c => arrowMarker(markerId.get(c), c)).join('')}
    </defs>`
  for (const edge of goal.edges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (!from || !to) continue
    const d = edgePath(from, to, nodeHeight(edge.from), nodeHeight(edge.to))
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    const selected = appState.selectedEdge?.from === edge.from && appState.selectedEdge?.to === edge.to
    path.setAttribute('class', selected ? 'edge selected' : 'edge')
    const custom = isHexColor(edge.color) ? edge.color : null
    path.style.stroke = custom ?? ''
    path.setAttribute('marker-end', `url(#${custom ? markerId.get(custom) : 'arrow'})`)
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
    return `<textarea class="title-input" data-id="${node.id}" rows="1"></textarea>`
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
  const steps = predecessorsOf(goal, node.id)
  if (steps.length === 0) return ''
  if (node.collapsed) {
    const count = collapsedCount(goal, node.id)
    return `<button class="collapse-btn collapsed" data-id="${node.id}" title="展开前序步骤">${count}▸</button>`
  }
  return `<button class="collapse-btn" data-id="${node.id}" title="收起前序步骤">▾</button>`
}

export function render() {
  const goal = appState.goal
  const hidden = hiddenByCollapse(goal)
  const visible = new Set(goal.nodes.filter(n => !hidden.has(n.id)).map(n => n.id))
  const detailHeights = Object.fromEntries([...appState.nodeHeights.entries()]
    .filter(([id, height]) => visible.has(id) && height > NODE_H)
    .map(([id, height]) => [id, height - NODE_H]))

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
        <div class="connector" data-id="${node.id}" title="拖出连线建立依赖"></div>
      </div>`
    // text fields are set via textContent/value to avoid HTML injection
    const titleEl = el.querySelector('.title')
    if (titleEl) titleEl.textContent = node.title || '（未命名）'
    const inputEl = el.querySelector('.title-input')
    if (inputEl) inputEl.value = node.title
    layer.appendChild(el)
  }
  syncMeasuredNodeHeights(layer, visible)

  const goalName = document.getElementById('goalName')
  goalName.textContent = goal.title || '（未命名）'
  const goalNameInput = document.getElementById('goalNameInput')
  if (document.activeElement !== goalNameInput) goalNameInput.value = goal.title

  const menu = document.getElementById('goalMenu')
  menu.innerHTML = ''
  for (const entry of appState.store.goals) {
    const item = document.createElement('button')
    item.className = 'goal-menu-item' + (entry.id === appState.store.currentId ? ' current' : '')
    item.dataset.id = entry.id
    item.textContent = entry.goal.title || '（未命名）'
    menu.appendChild(item)
  }
  const sep = document.createElement('div')
  sep.className = 'goal-menu-sep'
  menu.appendChild(sep)
  for (const [id, label] of [['goalMenuNew', '＋ 新建 Goal'], ['goalMenuDelete', '🗑 删除当前 Goal']]) {
    const action = document.createElement('button')
    action.id = id
    action.className = 'goal-menu-action'
    action.textContent = label
    menu.appendChild(action)
  }

  const fileStatus = document.getElementById('fileStatus')
  fileStatus.hidden = !fileBound()
  fileStatus.textContent = '📁 ' + boundFileName()
  document.getElementById('btnBindFile').hidden = fileBound() || !fileApiAvailable()

  document.getElementById('storageWarning').hidden = !appState.storageBroken
  document.getElementById('fileReconnectBar').hidden = !appState.fileReconnect

  updateTransform()

  const editing = layer.querySelector('.title-input')
  if (editing) {
    editing.focus()
    editing.select()
    autosizeTitleInput(editing)
  }
}

// grow the multi-line title editor to fit its content so the whole (often
// wrapped) title stays visible while editing, instead of a cramped one-liner
export function autosizeTitleInput(el) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function syncMeasuredNodeHeights(layer, visible) {
  let changed = false
  for (const id of [...appState.nodeHeights.keys()]) {
    if (!visible.has(id)) {
      appState.nodeHeights.delete(id)
      changed = true
    }
  }
  for (const el of layer.querySelectorAll('.node')) {
    const id = el.dataset.id
    // a node being edited shows a single-line input, not its real content;
    // measuring that transient height would reflow the layout and trigger a
    // re-render that tears the focused input out mid-edit (closing it). Keep
    // the last real height until editing ends and the title is measured again.
    if (id === appState.editingId) continue
    const height = Math.ceil(el.querySelector('.card')?.getBoundingClientRect().height ?? NODE_H)
    if (Math.abs((appState.nodeHeights.get(id) ?? NODE_H) - height) > 1) {
      appState.nodeHeights.set(id, height)
      changed = true
    }
  }
  if (changed) requestAnimationFrame(() => appState.renderFn())
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
  const bottom = sy + nodeHeight(id) * appState.zoom
  if (right > rect.width - margin) appState.pan.x -= right - (rect.width - margin)
  if (bottom > rect.height - margin) appState.pan.y -= bottom - (rect.height - margin)
  updateTransform()
}
