import {
  addNode, updateNode, removeNode, addEdge, removeEdge, createGoal
} from '../core/model.js'
import { predecessorsOf, successorsOf, wouldCreateCycle } from '../core/graph.js'
import { exportJSON, importJSON } from '../core/serialize.js'
import { addGoal, switchGoal, removeGoal, renameCurrentGoal } from '../core/store.js'
import {
  appState, setGoal, setStore, selectNode, startEditing, stopEditing, rerender,
  undoGoal, redoGoal, storeWithCurrentLayoutOrder
} from './state.js'
import { render, ensureVisible, updateTransform, autosizeTitleInput, centerVisibleNodes, NODE_W, NODE_H } from './render.js'
import { reorderChildEdges, reorderEdgesByPlacement } from '../core/layout.js'
import { bindFile, unbindFile } from './storage.js'
import { openNodeStylePanel, openEdgeStylePanel, closeStylePanel } from './style-panel.js'

const STATUS_CYCLE = { todo: 'doing', doing: 'done', done: 'todo' }
const INTERACTIONS_LAYOUT_DIRECTION_KEY = 'taskdag-layout-direction'

function screenToWorld(clientX, clientY) {
  const rect = document.getElementById('canvas').getBoundingClientRect()
  return {
    x: (clientX - rect.left - appState.pan.x) / appState.zoom,
    y: (clientY - rect.top - appState.pan.y) / appState.zoom
  }
}

function isTextTarget(target) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function isComposingInput(e) {
  const composingTarget = e.target?.dataset?.imeComposing === 'true'
  const ignoreNextEnter = e.key === 'Enter' && e.target?.dataset?.ignoreNextEnter === 'true'
  if (ignoreNextEnter) delete e.target.dataset.ignoreNextEnter
  return e.isComposing || e.keyCode === 229 || composingTarget || ignoreNextEnter
}

function lastNodeId(goal) {
  return goal.nodes[goal.nodes.length - 1].id
}

// ---------- node creation ----------

function createSuccessor() {
  const goal = appState.goal
  const selected = appState.selectedId
  if (!selected) return
  const parent = goal.nodes.find(n => n.id === selected)
  const type = parent.type === 'goal' ? 'project' : 'task'
  let next = addNode(goal, { title: '', type })
  const newId = lastNodeId(next)
  next = addEdge(next, newId, selected)
  setGoal(next)
  startEditing(newId, true)
  ensureVisible(newId)
}

function createParallel() {
  const goal = appState.goal
  const selected = appState.selectedId
  if (!selected || selected === 'root') return
  const current = goal.nodes.find(n => n.id === selected)
  const parents = successorsOf(goal, selected)
  let next = addNode(goal, { title: '', type: current.type })
  const newId = lastNodeId(next)
  for (const parent of parents) next = addEdge(next, newId, parent.id)
  for (const parent of parents) {
    const siblings = next.edges
      .filter(e => e.to === parent.id)
      .map(e => e.from)
    const ordered = []
    for (const id of siblings) {
      if (id === newId) continue
      ordered.push(id)
      if (id === selected) ordered.push(newId)
    }
    if (!ordered.includes(newId)) ordered.push(newId)
    next = reorderChildEdges(next, parent.id, ordered)
  }
  setGoal(next)
  startEditing(newId, true)
  ensureVisible(newId)
}

function createFloating(worldPos) {
  let next = addNode(appState.goal, { title: '', type: 'task' })
  const newId = lastNodeId(next)
  next = updateNode(next, newId, { x: worldPos.x, y: worldPos.y })
  setGoal(next)
  startEditing(newId, true)
}

function deleteSelected() {
  const selected = [...appState.selectedIds].filter(id => id !== 'root')
  if (selected.length === 0 && appState.selectedId && appState.selectedId !== 'root') {
    selected.push(appState.selectedId)
  }
  if (selected.length === 0) return
  appState.selectedId = null
  appState.selectedIds.clear()
  appState.selectedEdge = null
  setGoal(selected.reduce((goal, id) => removeNode(goal, id), appState.goal))
}

function removeEdgePreservingPositions(goal, from, to) {
  return removeEdge(goal, from, to)
}

function deleteSelectedEdge() {
  const edge = appState.selectedEdge
  if (!edge) return false
  if (!appState.goal.edges.some(e => e.from === edge.from && e.to === edge.to)) {
    appState.selectedEdge = null
    rerender()
    return false
  }
  appState.selectedEdge = null
  setGoal(removeEdgePreservingPositions(appState.goal, edge.from, edge.to))
  return true
}

// ---------- title editing ----------

function commitEdit(input) {
  const id = appState.editingId
  if (!id) return
  const title = input.value.trim()
  const wasNew = appState.editingIsNew
  stopEditing()
  if (title === '' && wasNew) {
    appState.selectedId = null
    appState.selectedIds.clear()
    setGoal(removeNode(appState.goal, id))
    return
  }
  if (title === '') { rerender(); return }
  let next = updateNode(appState.goal, id, { title })
  if (id === 'root') next = { ...next, title }
  setGoal(next)
}

function cancelEdit() {
  const id = appState.editingId
  const wasNew = appState.editingIsNew
  stopEditing()
  if (wasNew && id) {
    appState.selectedId = null
    appState.selectedIds.clear()
    setGoal(removeNode(appState.goal, id))
    return
  }
  rerender()
}

// ---------- keyboard navigation ----------

function moveSelection(direction) {
  const selected = appState.selectedId
  const positions = appState.lastPositions
  if (!selected || !positions.has(selected)) return
  const goal = appState.goal
  const visible = appState.lastVisible
  let target = null
  if (direction === 'left' || direction === 'right') {
    const neighbors = direction === 'left'
      ? predecessorsOf(goal, selected) : successorsOf(goal, selected)
    const candidates = neighbors.filter(n => visible.has(n.id))
    const myY = positions.get(selected).y
    candidates.sort((a, b) =>
      Math.abs(positions.get(a.id).y - myY) - Math.abs(positions.get(b.id).y - myY))
    target = candidates[0]?.id ?? null
  } else {
    const myPos = positions.get(selected)
    const column = [...visible]
      .filter(id => id !== selected && positions.get(id)?.x === myPos.x)
      .sort((a, b) => positions.get(a).y - positions.get(b).y)
    if (direction === 'up') {
      target = column.filter(id => positions.get(id).y < myPos.y).pop() ?? null
    } else {
      target = column.find(id => positions.get(id).y > myPos.y) ?? null
    }
  }
  if (target) {
    selectNode(target)
    ensureVisible(target)
  }
}

function onKeydown(e) {
  if (isComposingInput(e)) return
  const commandKey = e.metaKey || e.ctrlKey
  if (commandKey && e.key.toLowerCase() === 'z' && !isTextTarget(e.target)) {
    e.preventDefault()
    if (e.shiftKey) redoGoal()
    else undoGoal()
    return
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'y' && !isTextTarget(e.target)) {
    e.preventDefault()
    redoGoal()
    return
  }
  if (isTextTarget(e.target)) {
    if (e.target.classList.contains('title-input')) {
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit(e.target) }
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
      e.stopPropagation()
    }
    return
  }
  switch (e.key) {
    case 'Tab': e.preventDefault(); createSuccessor(); break
    case 'Enter': e.preventDefault(); createParallel(); break
    case 'F2':
      if (appState.selectedId) { e.preventDefault(); startEditing(appState.selectedId) }
      break
    case 'Delete': case 'Backspace':
      e.preventDefault()
      if (!deleteSelectedEdge()) deleteSelected()
      break
    case ' ': {
      e.preventDefault()
      const id = appState.selectedId
      if (id && id !== 'root') {
        const node = appState.goal.nodes.find(n => n.id === id)
        setGoal(updateNode(appState.goal, id, { status: STATUS_CYCLE[node.status] }))
      }
      break
    }
    case 'd': case 'D': {
      const id = appState.selectedId
      if (id) {
        const card = document.querySelector(`.node[data-id="${id}"] .card`)
        const rect = card?.getBoundingClientRect()
        if (rect) openNodeStylePanel(id, rect.right, rect.top)
      }
      break
    }
    case 'ArrowLeft': e.preventDefault(); moveSelection('left'); break
    case 'ArrowRight': e.preventDefault(); moveSelection('right'); break
    case 'ArrowUp': e.preventDefault(); moveSelection('up'); break
    case 'ArrowDown': e.preventDefault(); moveSelection('down'); break
    case 'Escape':
      appState.selectedId = null
      appState.selectedIds.clear()
      appState.selectedEdge = null
      rerender()
      break
  }
}

// ---------- mouse: drag node / draw edge / pan ----------

function flashRed(nodeId) {
  const el = document.querySelector(`.node[data-id="${nodeId}"]`)
  if (!el) return
  el.classList.add('flash-red')
  setTimeout(() => el.classList.remove('flash-red'), 900)
}

function primaryParentOf(goal, id, visible) {
  const edge = goal.edges.find(e => e.from === id && visible.has(e.to))
  return edge ? edge.to : null
}

// visible tree-children of parentId (nodes whose primary parent is parentId),
// in edge order — which is also their vertical order in the auto layout
function treeSiblings(goal, parentId, visible) {
  return goal.edges
    .filter(e => e.to === parentId && visible.has(e.from)
      && primaryParentOf(goal, e.from, visible) === parentId)
    .map(e => e.from)
}

function replacePrimaryParentEdge(goal, childId, oldParentId, newParentId) {
  const oldEdge = goal.edges.find(e => e.from === childId && e.to === oldParentId)
  const replacement = { ...(oldEdge ?? {}), from: childId, to: newParentId }
  let inserted = false
  const edges = []
  for (const edge of goal.edges) {
    if (edge.from === childId && edge.to === oldParentId) {
      if (!inserted) {
        edges.push(replacement)
        inserted = true
      }
      continue
    }
    if (edge.from === childId && edge.to === newParentId) continue
    edges.push(edge)
  }
  if (!inserted) edges.push(replacement)
  return { ...goal, edges }
}

function edgePathBetween(from, to, fromHeight = NODE_H, toHeight = NODE_H) {
  const targetOnRight = to.x + NODE_W / 2 >= from.x + NODE_W / 2
  const dir = targetOnRight ? 1 : -1
  const x1 = targetOnRight ? from.x + NODE_W + 9 : from.x - 9
  const y1 = from.y + fromHeight / 2
  const x2 = targetOnRight ? to.x : to.x + NODE_W
  const y2 = to.y + toHeight / 2
  const dx = Math.max(40, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dir * dx} ${y1}, ${x2 - dir * dx} ${y2}, ${x2} ${y2}`
}

function reparentPreviewLine() {
  const svg = document.getElementById('edges')
  let line = document.getElementById('reparent-preview-line')
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    line.id = 'reparent-preview-line'
    line.setAttribute('marker-end', 'url(#arrow)')
    svg.appendChild(line)
  }
  return line
}

function clearReparentPreview() {
  document.getElementById('reparent-preview-line')?.remove()
  document.querySelectorAll('.node.reparent-target')
    .forEach(node => node.classList.remove('reparent-target'))
}

function proposedParentForDrag(id, dragLeft, dragTop, oldParentId) {
  if (!oldParentId) return null
  const dragCenter = { x: dragLeft + NODE_W / 2, y: dragTop + NODE_H / 2 }
  const isRtl = appState.layoutDirection === 'rtl'
  let best = null
  for (const targetId of appState.lastVisible) {
    if (targetId === id || targetId === oldParentId) continue
    const targetPos = appState.lastPositions.get(targetId)
    if (!targetPos) continue
    const targetHeight = appState.nodeHeights.get(targetId) ?? NODE_H
    const targetCenter = {
      x: targetPos.x + NODE_W / 2,
      y: targetPos.y + targetHeight / 2
    }
    const signedDx = dragCenter.x - targetCenter.x
    const childSideDistance = isRtl ? -signedDx : signedDx
    if (childSideDistance < NODE_W * 0.7 || childSideDistance > 460) continue
    const dy = Math.abs(dragCenter.y - targetCenter.y)
    if (dy > Math.max(96, targetHeight / 2 + 64)) continue
    const next = removeEdgePreservingPositions(appState.goal, id, oldParentId)
    if (wouldCreateCycle(next, id, targetId)) continue
    const score = dy + Math.abs(childSideDistance - 300) * 0.35
    if (!best || score < best.score) best = { id: targetId, score }
  }
  return best?.id ?? null
}

function showReparentPreview(childPos, targetId) {
  clearReparentPreview()
  if (!targetId) return
  const targetPos = appState.lastPositions.get(targetId)
  if (!targetPos) return
  const line = reparentPreviewLine()
  line.setAttribute('d', edgePathBetween(childPos, targetPos, NODE_H, appState.nodeHeights.get(targetId) ?? NODE_H))
  document.querySelector(`.node[data-id="${targetId}"]`)?.classList.add('reparent-target')
}

function reparentNodeByDrop(id, oldParentId, newParentId, dropY) {
  let next = replacePrimaryParentEdge(appState.goal, id, oldParentId, newParentId)
  const visible = appState.lastVisible
  const siblings = treeSiblings(next, newParentId, visible)
  const ordered = siblings
    .map((siblingId, index) => ({
      id: siblingId,
      index,
      y: siblingId === id ? dropY : appState.lastPositions.get(siblingId)?.y ?? Infinity
    }))
    .sort((a, b) => a.y - b.y || a.index - b.index)
    .map(item => item.id)
  next = reorderChildEdges(next, newParentId, ordered)
  setGoal(updateNode(next, id, { x: null, y: null }))
}

// While dragging a tree node, reorder it among its siblings as its y crosses
// sibling rows. Returns true when a reorder happened (and the DOM re-rendered).
function realignDuringDrag(id, dragY) {
  const goal = appState.goal
  const visible = appState.lastVisible
  const parent = primaryParentOf(goal, id, visible)
  if (!parent) return false
  const siblings = treeSiblings(goal, parent, visible)
  if (siblings.length < 2) return false
  const others = siblings.filter(s => s !== id)
  let index = others.length
  for (let i = 0; i < others.length; i++) {
    if (dragY < (appState.lastPositions.get(others[i])?.y ?? 0)) { index = i; break }
  }
  const desired = [...others.slice(0, index), id, ...others.slice(index)]
  if (desired.every((s, i) => s === siblings[i])) return false
  setGoal(reorderChildEdges(goal, parent, desired))
  return true
}

function startNodeDrag(e, nodeEl) {
  const id = nodeEl.dataset.id
  const additiveSelection = e.metaKey || e.ctrlKey
  const startMouse = screenToWorld(e.clientX, e.clientY)
  const startLeft = parseFloat(nodeEl.style.left)
  const startTop = parseFloat(nodeEl.style.top)
  const oldParentId = primaryParentOf(appState.goal, id, appState.lastVisible)
  // tree nodes live-realign and snap back into the layout on drop;
  // root and floating (orphan) nodes keep free manual placement
  const isTreeNode = id !== 'root'
    && oldParentId !== null
  let el = nodeEl
  let moved = false
  let proposedParentId = null
  clearReparentPreview()

  function onMove(ev) {
    const current = screenToWorld(ev.clientX, ev.clientY)
    const dx = current.x - startMouse.x
    const dy = current.y - startMouse.y
    if (!moved && Math.hypot(dx, dy) * appState.zoom < 4) return
    moved = true
    if (isTreeNode && realignDuringDrag(id, startTop + dy)) {
      el = document.querySelector(`.node[data-id="${id}"]`) ?? el
    }
    const dragLeft = startLeft + dx
    const dragTop = startTop + dy
    el.style.left = dragLeft + 'px'
    el.style.top = dragTop + 'px'
    proposedParentId = isTreeNode
      ? proposedParentForDrag(id, dragLeft, dragTop, oldParentId)
      : null
    showReparentPreview({ x: dragLeft, y: dragTop }, proposedParentId)
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    clearReparentPreview()
    if (moved) {
      const current = screenToWorld(ev.clientX, ev.clientY)
      const y = startTop + (current.y - startMouse.y)
      if (isTreeNode && proposedParentId) {
        reparentNodeByDrop(id, oldParentId, proposedParentId, y)
      } else if (isTreeNode) {
        realignDuringDrag(id, y)
        // drop the manual position so the node snaps into its layout slot
        setGoal(updateNode(appState.goal, id, { x: null, y: null }))
      } else {
        setGoal(updateNode(appState.goal, id, {
          x: startLeft + (current.x - startMouse.x), y
        }))
      }
    } else {
      selectNode(id, { additive: additiveSelection })
      closeStylePanel()
    }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startEdgeDrag(e, fromId) {
  const canvas = document.getElementById('canvas')
  const svg = document.getElementById('edges')
  const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  temp.id = 'templine'
  temp.setAttribute('marker-end', 'url(#arrow)')
  svg.appendChild(temp)
  const fromPos = appState.lastPositions.get(fromId)
  const sourceEl = document.querySelector(`.node[data-id="${fromId}"]`)
  sourceEl?.classList.add('drawing-source')
  canvas.classList.add('drawing-edge')
  const x1 = fromPos.x - 9
  const y1 = fromPos.y + NODE_H / 2

  function onMove(ev) {
    const p = screenToWorld(ev.clientX, ev.clientY)
    const dir = p.x >= x1 ? 1 : -1
    const dx = Math.max(40, Math.abs(p.x - x1) / 2)
    temp.setAttribute('d', `M ${x1} ${y1} C ${x1 + dir * dx} ${y1}, ${p.x - dir * dx} ${p.y}, ${p.x} ${p.y}`)
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    canvas.classList.remove('drawing-edge')
    sourceEl?.classList.remove('drawing-source')
    temp.remove()
    const targetEl = ev.target.closest?.('.node')
    if (!targetEl) return
    const toId = targetEl.dataset.id
    if (toId === fromId) return
    if (appState.goal.edges.some(edge => edge.from === fromId && edge.to === toId)) return
    if (wouldCreateCycle(appState.goal, fromId, toId)) {
      flashRed(toId)
      return
    }
    setGoal(addEdge(appState.goal, fromId, toId))
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startPan(e) {
  const canvas = document.getElementById('canvas')
  canvas.classList.add('panning')
  const startX = e.clientX - appState.pan.x
  const startY = e.clientY - appState.pan.y
  function onMove(ev) {
    appState.pan.x = ev.clientX - startX
    appState.pan.y = ev.clientY - startY
    updateTransform()
  }
  function onUp() {
    canvas.classList.remove('panning')
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function onWheel(e) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  const newZoom = Math.min(2, Math.max(0.25, appState.zoom * factor))
  const rect = document.getElementById('canvas').getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const wx = (mx - appState.pan.x) / appState.zoom
  const wy = (my - appState.pan.y) / appState.zoom
  appState.zoom = newZoom
  appState.pan.x = mx - wx * newZoom
  appState.pan.y = my - wy * newZoom
  updateTransform()
}

// ---------- toolbar ----------

function downloadExport() {
  const goal = appState.goal
  const blob = new Blob([exportJSON(goal)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `taskdag-${(goal.title || 'goal').replace(/[\\/:*?"<>|]/g, '_')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// import adds the goal as a new canvas and switches to it — nothing is overwritten
function handleImportFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const imported = importJSON(reader.result)
      setStore(addGoal(appState.store, imported))
    } catch (error) {
      window.alert('导入失败：' + error.message)
    }
  }
  reader.readAsText(file)
}

async function handleBindFile() {
  try {
    const adopted = await bindFile(storeWithCurrentLayoutOrder())
    if (adopted) {
      setStore(adopted)
    } else {
      rerender()
    }
  } catch (error) {
    if (error.name !== 'AbortError') window.alert('绑定失败：' + error.message)
  }
}

function resetLayout() {
  if (!window.confirm('清除所有手动调整的位置，恢复自动布局？（同层节点保持当前的上下顺序）')) return
  // persist the user's current vertical ordering into edge order first,
  // so the auto layout keeps siblings where the user placed them
  let next = reorderEdgesByPlacement(appState.goal, appState.lastPositions)
  for (const node of next.nodes) {
    if (node.x !== null || node.y !== null) {
      next = updateNode(next, node.id, { x: null, y: null })
    }
  }
  setGoal(next)
}

// ---------- goal title control: inline rename + switch/new/delete menu ----------

function setupGoalControl() {
  const control = document.getElementById('goalControl')
  const name = document.getElementById('goalName')
  const input = document.getElementById('goalNameInput')
  const menu = document.getElementById('goalMenu')
  const menuBtn = document.getElementById('goalMenuBtn')

  const closeMenu = () => { menu.hidden = true }
  const showRename = () => {
    input.value = appState.goal.title
    name.hidden = true
    input.hidden = false
    control.classList.add('renaming')
    input.focus()
    input.select()
  }
  const endRename = (commit) => {
    if (input.hidden) return
    input.hidden = true
    name.hidden = false
    control.classList.remove('renaming')
    const title = input.value.trim() || appState.goal.title
    if (commit && title !== appState.goal.title) {
      setStore(renameCurrentGoal(appState.store, title))
    }
  }

  name.addEventListener('click', showRename)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); endRename(true) }
    else if (e.key === 'Escape') { e.preventDefault(); endRename(false) }
    e.stopPropagation()
  })
  input.addEventListener('blur', () => endRename(true))

  menuBtn.addEventListener('click', e => {
    e.stopPropagation()
    menu.hidden = !menu.hidden
  })
  menu.addEventListener('click', e => {
    const item = e.target.closest('.goal-menu-item')
    if (item) { closeMenu(); setStore(switchGoal(appState.store, item.dataset.id)); return }
    const action = e.target.closest('.goal-menu-action')
    if (!action) return
    if (action.id === 'goalMenuNew') {
      closeMenu()
      const newName = window.prompt('新 Goal 的名称：', '新目标')
      if (newName === null) return
      setStore(addGoal(appState.store, createGoal(newName.trim() || '新目标')))
      return
    }
    if (action.id === 'goalMenuDelete') {
      closeMenu()
      if (appState.store.goals.length === 1) {
        window.alert('至少保留一个 Goal，无法删除')
        return
      }
      if (!window.confirm(`删除整个 Goal「${appState.goal.title}」及其全部任务？此操作不可恢复。`)) return
      setStore(removeGoal(appState.store, appState.store.currentId))
      return
    }
    if (action.id === 'btnBindFile') {
      closeMenu()
      handleBindFile()
      return
    }
    if (action.id === 'fileStatus') {
      closeMenu()
      void (async () => {
        if (!window.confirm('解除数据文件绑定？（文件保留，此后更改只存在浏览器本地）')) return
        await unbindFile()
        rerender()
      })()
      return
    }
    if (action.id === 'btnLayout') {
      closeMenu()
      resetLayout()
      return
    }
    if (action.id === 'btnExport') {
      closeMenu()
      downloadExport()
      return
    }
    if (action.id === 'btnImportJson') {
      closeMenu()
      document.getElementById('importFile').click()
    }
  })

  document.addEventListener('mousedown', e => {
    if (!menu.hidden && !e.target.closest('#goalControl')) closeMenu()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) closeMenu()
  })
}

function setupInfoControl() {
  const button = document.getElementById('btnInfo')
  const hint = document.getElementById('hint')

  const setOpen = open => {
    hint.hidden = !open
    button.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  button.addEventListener('click', e => {
    e.stopPropagation()
    setOpen(hint.hidden)
  })

  document.addEventListener('mousedown', e => {
    if (!hint.hidden && !e.target.closest('#infoControl') && !e.target.closest('#hint')) {
      setOpen(false)
    }
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !hint.hidden) setOpen(false)
  })
}

function setupDirectionControl() {
  document.getElementById('btnDirection').addEventListener('click', () => {
    appState.layoutDirection = appState.layoutDirection === 'rtl' ? 'ltr' : 'rtl'
    try {
      localStorage.setItem(INTERACTIONS_LAYOUT_DIRECTION_KEY, appState.layoutDirection)
    } catch (error) {
      // view preference is optional; rendering still updates for this session
    }
    rerender()
    centerVisibleNodes()
  })
}

// ---------- wiring ----------

export function setupInteractions() {
  const canvas = document.getElementById('canvas')
  const nodes = document.getElementById('nodes')

  document.addEventListener('keydown', onKeydown)
  document.addEventListener('compositionstart', e => {
    if (isTextTarget(e.target)) e.target.dataset.imeComposing = 'true'
  }, true)
  document.addEventListener('compositionend', e => {
    if (!isTextTarget(e.target)) return
    e.target.dataset.imeComposing = 'false'
    e.target.dataset.ignoreNextEnter = 'true'
    setTimeout(() => {
      if (e.target?.dataset?.ignoreNextEnter === 'true') delete e.target.dataset.ignoreNextEnter
    }, 250)
  }, true)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    if (e.target === canvas || e.target.id === 'world' || e.target.id === 'edges') {
      startPan(e)
    }
  })

  canvas.addEventListener('dblclick', e => {
    if (e.target === canvas || e.target.id === 'world' || e.target.id === 'edges') {
      const p = screenToWorld(e.clientX, e.clientY)
      createFloating({ x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 })
    }
  })

  nodes.addEventListener('mousedown', e => {
    if (e.button !== 0) return
    if (e.target.classList.contains('connector')) {
      e.stopPropagation()
      startEdgeDrag(e, e.target.dataset.id)
      return
    }
    if (isTextTarget(e.target) || e.target.tagName === 'BUTTON') return
    const nodeEl = e.target.closest('.node')
    if (nodeEl) startNodeDrag(e, nodeEl)
  })

  nodes.addEventListener('dblclick', e => {
    if (isTextTarget(e.target)) return
    const card = e.target.closest('.card')
    if (card) {
      const rect = card.getBoundingClientRect()
      openNodeStylePanel(card.dataset.id, rect.right, rect.top)
    }
  })

  nodes.addEventListener('click', e => {
    const collapseBtn = e.target.closest('.collapse-btn')
    if (collapseBtn) {
      const id = collapseBtn.dataset.id
      const node = appState.goal.nodes.find(n => n.id === id)
      if ((node.chainStatus ?? 'active') === 'paused') return
      setGoal(updateNode(appState.goal, id, { collapsed: !node.collapsed }))
      return
    }
  })

  nodes.addEventListener('focusout', e => {
    if (e.target.classList.contains('title-input')) commitEdit(e.target)
  })

  nodes.addEventListener('input', e => {
    if (e.target.classList.contains('title-input')) autosizeTitleInput(e.target)
  })

  function selectEdgeHit(hit) {
    appState.selectedId = null
    appState.selectedIds.clear()
    appState.selectedEdge = { from: hit.dataset.from, to: hit.dataset.to }
    rerender()
  }

  document.getElementById('edges').addEventListener('mousedown', e => {
    if (e.button !== 0) return
    const hit = e.target.closest('.edge-hit')
    if (!hit) return
    selectEdgeHit(hit)
    openEdgeStylePanel(hit.dataset.from, hit.dataset.to, e.clientX, e.clientY)
  })

  document.getElementById('edges').addEventListener('click', e => {
    const hit = e.target.closest('.edge-hit')
    if (!hit) return
    selectEdgeHit(hit)
    openEdgeStylePanel(hit.dataset.from, hit.dataset.to, e.clientX, e.clientY)
  })

  document.getElementById('edges').addEventListener('contextmenu', e => {
    const hit = e.target.closest('.edge-hit')
    if (!hit) return
    e.preventDefault()
    if (window.confirm('删除这条依赖？')) {
      appState.selectedId = null
      appState.selectedIds.clear()
      appState.selectedEdge = null
      setGoal(removeEdgePreservingPositions(appState.goal, hit.dataset.from, hit.dataset.to))
    }
  })

  setupGoalControl()
  setupDirectionControl()
  setupInfoControl()
  document.getElementById('btnFileReconnect').addEventListener('click', async () => {
    const resume = appState.fileReconnect
    if (!resume) return
    try {
      const store = await resume()
      appState.fileReconnect = null
      if (store) {
        setStore(store)
      } else {
        rerender()
      }
    } catch (error) {
      window.alert('连接失败：' + error.message)
    }
  })
  document.getElementById('importFile').addEventListener('change', e => {
    if (e.target.files[0]) handleImportFile(e.target.files[0])
    e.target.value = ''
  })
  document.getElementById('btnZoomReset').addEventListener('click', () => {
    centerVisibleNodes({ resetZoom: true })
  })
}
