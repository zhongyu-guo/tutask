import { predecessorsOf, hiddenByCollapse, collapsedCount, nodeType, isReady } from '../core/graph.js'
import { autoLayout, resolvePositions } from '../core/layout.js'
import { timelineLayout, countdownLabel } from '../core/timeline-layout.js'
import { appState } from './state.js'
import { fileBound, boundFileName, fileApiAvailable } from './storage.js'

export const NODE_W = 210
export const NODE_H = 64
export const DEFAULT_PAN_X = 80
const GAP_X = 300
const GAP_Y = 104

// timeline layout: row pitch and column widths (must exceed NODE_W). TL_PAD is
// the visual gutter each column band extends past the node on the left.
const TL_ROW_H = NODE_H + 40
const TL_HEADER_H = 56
const TL_PAD = 16
const TL_COL_W = { day: NODE_W + 2 * TL_PAD, week: NODE_W + 2 * TL_PAD + 24, month: NODE_W + 2 * TL_PAD + 48 }

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

function nodeById(goal) {
  return new Map(goal.nodes.map(node => [node.id, node]))
}

function edgeChainStatus(nodes, edge) {
  const from = nodes.get(edge.from)
  const to = nodes.get(edge.to)
  return from?.chainStatus === 'paused' || to?.chainStatus === 'paused' ? 'paused' : 'active'
}

function nodeHeight(id) {
  return appState.nodeHeights.get(id) ?? NODE_H
}

function visibleNodeBounds() {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of appState.lastVisible) {
    const pos = appState.lastPositions.get(id)
    if (!pos) continue
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
    maxX = Math.max(maxX, pos.x + NODE_W)
    maxY = Math.max(maxY, pos.y + nodeHeight(id))
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

function applyLayoutDirection(positions) {
  if (appState.layoutDirection !== 'rtl') return positions
  const root = positions.get('root')
  if (!root) return positions
  const mirrored = new Map()
  for (const [id, pos] of positions.entries()) {
    mirrored.set(id, {
      x: root.x - (pos.x - root.x),
      y: pos.y
    })
  }
  return mirrored
}

function initialPanX(canvas) {
  if (appState.layoutDirection === 'rtl') {
    return Math.max(16, Math.round(canvas.clientWidth - DEFAULT_PAN_X - NODE_W * appState.zoom))
  }
  return DEFAULT_PAN_X
}

export function centerVisibleNodes({ resetZoom = false } = {}) {
  const canvas = document.getElementById('canvas')
  const bounds = visibleNodeBounds()
  if (resetZoom) appState.zoom = 1
  appState.pan.x = initialPanX(canvas)
  if (!bounds) {
    appState.pan.y = Math.round(canvas.clientHeight / 2)
    updateTransform()
    return
  }
  const boundsCenterY = (bounds.minY + bounds.maxY) / 2
  appState.pan.y = Math.round(canvas.clientHeight / 2 - boundsCenterY * appState.zoom)
  updateTransform()
}

function renderEdges(svg, goal, positions, visible) {
  // one extra arrowhead marker per custom edge color, so heads match their line
  // (colors go into innerHTML, so only hex values from the color picker are accepted)
  const customColors = [...new Set(
    goal.edges.map(e => e.color).filter(c => isHexColor(c)))]
  const markerId = new Map(customColors.map((c, i) => [c, `arrow-c${i}`]))
  const nodes = nodeById(goal)
  svg.innerHTML = `
    <defs>
      ${arrowMarker('arrow', 'var(--edge-active)')}
      ${arrowMarker('arrow-paused', 'var(--edge-paused)')}
      ${arrowMarker('arrow-selected', 'var(--danger)')}
      ${customColors.map(c => arrowMarker(markerId.get(c), c)).join('')}
    </defs>`
  const rendered = []
  for (const edge of goal.edges) {
    if (!visible.has(edge.from) || !visible.has(edge.to)) continue
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (!from || !to) continue
    rendered.push({
      edge,
      d: edgePath(from, to, nodeHeight(edge.from), nodeHeight(edge.to)),
      selected: appState.selectedEdge?.from === edge.from && appState.selectedEdge?.to === edge.to,
      chainStatus: edgeChainStatus(nodes, edge)
    })
  }
  const priority = item => item.selected ? 2 : item.chainStatus === 'active' ? 1 : 0
  rendered.sort((a, b) => priority(a) - priority(b))

  for (const item of rendered) {
    const { edge, d, selected, chainStatus } = item
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    path.setAttribute('class', `edge ${chainStatus}${selected ? ' selected' : ''}`)
    path.dataset.chainStatus = chainStatus
    const custom = chainStatus === 'active' && isHexColor(edge.color) ? edge.color : null
    if (custom && !selected) path.style.stroke = custom
    const marker = selected ? 'arrow-selected'
      : chainStatus === 'paused' ? 'arrow-paused'
        : custom ? markerId.get(custom)
          : 'arrow'
    path.setAttribute('marker-end', `url(#${marker})`)
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
  const classes = ['node', nodeType(goal, node), node.status]
  if ((node.chainStatus ?? 'active') === 'paused') classes.push('chain-paused')
  if (isReady(goal, node.id)) classes.push('ready')
  if (appState.selectedIds.has(node.id)) classes.push('selected')
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
    const countdown = countdownLabel(node.deadline, new Date())
    html += `<span class="badge deadline${isOverdue(node) ? ' overdue' : ''}">📅 ${node.deadline}` +
      `<span class="badge-countdown">${countdown}</span></span>`
  }
  return html ? `<div class="badges">${html}</div>` : ''
}

// the time ruler: column bands + headers + a no-DDL lane, drawn behind edges
// and nodes. Labels come from axis metadata (dates only — no user input).
function renderRuler(axis) {
  const ruler = document.getElementById('ruler')
  if (!axis) {
    ruler.hidden = true
    ruler.innerHTML = ''
    return
  }
  ruler.hidden = false
  const h = axis.contentHeight
  const band = (left, width, cls, primary, secondary) =>
    `<div class="tl-col${cls}" style="left:${left}px;width:${width}px;height:${h}px">
      <div class="tl-head" style="height:${TL_HEADER_H}px">
        <span class="tl-head-primary">${primary}</span>
        <span class="tl-head-secondary">${secondary}</span>
      </div>
    </div>`
  let html = ''
  for (const col of axis.columns) {
    const cls = (col.isToday ? ' today' : '') + (col.isEmpty ? ' empty' : '')
    const primary = col.isToday ? '今天' : col.label.primary
    const secondary = col.isToday ? col.label.primary : col.label.secondary
    html += band(col.x - TL_PAD, col.width, cls, primary, secondary)
  }
  html += band(axis.noDate.x - TL_PAD, axis.noDate.width, ' nodate', '无 DDL', '未排期')
  ruler.innerHTML = html
}

function syncTimelineControls(timeline) {
  const btn = document.getElementById('btnTimeline')
  btn.setAttribute('aria-pressed', timeline ? 'true' : 'false')
  btn.title = timeline ? '切回 DAG 布局' : '切换时间轴布局'
  document.getElementById('timelineControls').hidden = !timeline
  for (const el of document.querySelectorAll('#tlScale button')) {
    el.classList.toggle('on', el.dataset.scale === appState.timelineScale)
  }
  for (const el of document.querySelectorAll('#tlRange button')) {
    el.classList.toggle('on', el.dataset.range === appState.timelineRange)
  }
}

function renderCollapseBtn(goal, node) {
  const steps = predecessorsOf(goal, node.id)
  if (steps.length === 0) return ''
  const paused = (node.chainStatus ?? 'active') === 'paused'
  if (node.collapsed || paused) {
    const count = collapsedCount(goal, node.id)
    const cls = paused ? 'collapse-btn collapsed paused' : 'collapse-btn collapsed'
    const title = paused ? '链条挂起，子节点已收起' : '展开前序步骤'
    return `<button class="${cls}" data-id="${node.id}" title="${title}">${count}▸</button>`
  }
  return `<button class="collapse-btn" data-id="${node.id}" title="收起前序步骤">▾</button>`
}

// Keep selection honest: a node hidden by collapse/pause must not linger as a
// phantom selection, or keyboard shortcuts (Enter / Delete / Space) would target
// something invisible.
function pruneSelectionToVisible(visible) {
  for (const id of [...appState.selectedIds]) {
    if (!visible.has(id)) appState.selectedIds.delete(id)
  }
  if (appState.selectedId && !visible.has(appState.selectedId)) {
    appState.selectedId = appState.selectedIds.values().next().value ?? null
  }
}

export function render() {
  const goal = appState.goal
  const timeline = appState.layoutMode === 'timeline'
  let positions
  let visible
  let axis = null
  if (timeline) {
    // honor the current collapse state: only currently-visible nodes appear
    const hidden = hiddenByCollapse(goal)
    visible = new Set(goal.nodes.filter(n => !hidden.has(n.id)).map(n => n.id))
    const tl = timelineLayout(goal, {
      scale: appState.timelineScale,
      range: appState.timelineRange,
      today: new Date(),
      visible,
      colWidth: TL_COL_W,
      rowHeight: TL_ROW_H,
      headerHeight: TL_HEADER_H
    })
    positions = tl.positions
    axis = tl.axis
  } else {
    const hidden = hiddenByCollapse(goal)
    visible = new Set(goal.nodes.filter(n => !hidden.has(n.id)).map(n => n.id))
    const detailHeights = Object.fromEntries([...appState.nodeHeights.entries()]
      .filter(([id, height]) => visible.has(id) && height > NODE_H)
      .map(([id, height]) => [id, height - NODE_H]))
    const auto = autoLayout(goal, visible, { gapX: GAP_X, gapY: GAP_Y, detailHeights })
    positions = applyLayoutDirection(resolvePositions(goal, auto))
  }
  appState.lastPositions = positions
  appState.lastVisible = visible
  pruneSelectionToVisible(visible)
  appState.timelineAxis = axis

  renderRuler(axis)
  renderEdges(document.getElementById('edges'), goal, positions, visible)

  const layer = document.getElementById('nodes')
  layer.innerHTML = ''
  for (const node of goal.nodes) {
    if (!visible.has(node.id)) continue
    const pos = positions.get(node.id)
    const el = document.createElement('div')
    el.className = nodeClasses(goal, node) + (timeline ? ' tl-node' : '')
    el.dataset.id = node.id
    el.style.left = pos.x + 'px'
    el.style.top = pos.y + 'px'
    el.innerHTML = `
      ${timeline ? '' : renderCollapseBtn(goal, node)}
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

  renderGoalMenu(document.getElementById('goalMenu'))

  document.getElementById('storageWarning').hidden = !appState.storageBroken
  document.getElementById('fileReconnectBar').hidden = !appState.fileReconnect
  const directionBtn = document.getElementById('btnDirection')
  directionBtn.setAttribute('aria-pressed', appState.layoutDirection === 'rtl' ? 'true' : 'false')
  directionBtn.title = appState.layoutDirection === 'rtl'
    ? '切换为 Goal → Project → Task'
    : '切换为 Task ← Project ← Goal'
  syncTimelineControls(timeline)

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

// constant icon markup (no user input) for the goal dropdown actions
const GOAL_ACTIONS = [
  { id: 'goalMenuNew', danger: false, label: '新建目标',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' },
  { id: 'goalMenuDelete', danger: true, label: '删除当前目标',
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' }
]

const PROJECT_ACTIONS = [
  { id: 'btnLayout', label: '整理布局', primary: true,
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 14v7"/></svg>' },
  { id: 'btnExport', label: '导出 JSON', primary: true,
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>' },
  { id: 'btnImportJson', label: '导入 JSON', primary: true,
    icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>' }
]

function renderGoalMenu(menu) {
  menu.innerHTML = ''
  const label = document.createElement('div')
  label.className = 'goal-menu-label'
  label.textContent = '切换目标'
  menu.appendChild(label)

  for (const entry of appState.store.goals) {
    const current = entry.id === appState.store.currentId
    const item = document.createElement('button')
    item.className = 'goal-menu-item' + (current ? ' current' : '')
    item.dataset.id = entry.id
    const title = entry.goal.title || '（未命名）'
    item.title = title
    const check = document.createElement('span')
    check.className = 'goal-menu-check'
    check.textContent = current ? '✓' : ''
    const text = document.createElement('span')
    text.className = 'goal-menu-text'
    text.textContent = title
    item.append(check, text)
    menu.appendChild(item)
  }

  const sep = document.createElement('div')
  sep.className = 'goal-menu-sep'
  menu.appendChild(sep)

  const goalActionsLabel = document.createElement('div')
  goalActionsLabel.className = 'goal-menu-label'
  goalActionsLabel.textContent = '目标'
  menu.appendChild(goalActionsLabel)

  for (const action of GOAL_ACTIONS) {
    const btn = document.createElement('button')
    btn.id = action.id
    btn.className = 'goal-menu-action' + (action.danger ? ' danger' : '')
    btn.innerHTML = action.icon
    const text = document.createElement('span')
    text.textContent = action.label
    btn.appendChild(text)
    menu.appendChild(btn)
  }

  const toolsSep = document.createElement('div')
  toolsSep.className = 'goal-menu-sep'
  menu.appendChild(toolsSep)

  const toolsLabel = document.createElement('div')
  toolsLabel.className = 'goal-menu-label'
  toolsLabel.textContent = '项目工具'
  menu.appendChild(toolsLabel)

  if (fileBound()) {
    const btn = document.createElement('button')
    btn.id = 'fileStatus'
    btn.className = 'goal-menu-action file-bound'
    btn.title = '点击解除绑定'
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
    const text = document.createElement('span')
    text.className = 'goal-menu-text'
    text.textContent = '已绑定：' + boundFileName()
    btn.appendChild(text)
    menu.appendChild(btn)
  } else if (fileApiAvailable()) {
    const btn = document.createElement('button')
    btn.id = 'btnBindFile'
    btn.className = 'goal-menu-action primary'
    btn.title = '绑定 goals 数据目录（每个 Goal 一个 JSON 文件），localhost 与本地双击打开共用同一份数据'
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2"/><path d="M12 17h9"/><path d="M16.5 12.5L21 17l-4.5 4.5"/></svg>'
    const text = document.createElement('span')
    text.textContent = '绑定数据目录'
    btn.appendChild(text)
    menu.appendChild(btn)
  }

  for (const action of PROJECT_ACTIONS) {
    const btn = document.createElement('button')
    btn.id = action.id
    btn.className = 'goal-menu-action' + (action.primary ? ' primary' : '')
    btn.innerHTML = action.icon
    const text = document.createElement('span')
    text.textContent = action.label
    btn.appendChild(text)
    menu.appendChild(btn)
  }
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
