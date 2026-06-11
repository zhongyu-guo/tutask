import {
  addNode, updateNode, removeNode, addEdge, removeEdge, createGoal
} from '../core/model.js'
import { predecessorsOf, successorsOf, wouldCreateCycle } from '../core/graph.js'
import { exportJSON, importJSON } from '../core/serialize.js'
import { addGoal, switchGoal, removeGoal, renameCurrentGoal } from '../core/store.js'
import {
  appState, setGoal, setStore, selectNode, startEditing, stopEditing, rerender
} from './state.js'
import { render, ensureVisible, updateTransform, NODE_W, NODE_H } from './render.js'
import { bindFile, unbindFile } from './storage.js'

const STATUS_CYCLE = { todo: 'doing', doing: 'done', done: 'todo' }

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
  next = addEdge(next, selected, newId)
  setGoal(next)
  startEditing(newId, true)
  ensureVisible(newId)
}

function createParallel() {
  const goal = appState.goal
  const selected = appState.selectedId
  if (!selected || selected === 'root') return
  const current = goal.nodes.find(n => n.id === selected)
  const preds = predecessorsOf(goal, selected)
  let next = addNode(goal, { title: '', type: current.type })
  const newId = lastNodeId(next)
  for (const pred of preds) next = addEdge(next, pred.id, newId)
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
  const selected = appState.selectedId
  if (!selected || selected === 'root') return
  const goal = appState.goal
  const downstream = successorsOf(goal, selected).length
  const node = goal.nodes.find(n => n.id === selected)
  const message = downstream > 0
    ? `删除「${node.title || '未命名'}」？将断开与 ${downstream} 个前序步骤的连线（前序步骤保留）。`
    : `删除「${node.title || '未命名'}」？`
  if (!window.confirm(message)) return
  appState.selectedId = null
  setGoal(removeNode(goal, selected))
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
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); break
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
        const node = appState.goal.nodes.find(n => n.id === id)
        setGoal(updateNode(appState.goal, id, { detailOpen: !node.detailOpen }))
      }
      break
    }
    case 'ArrowLeft': e.preventDefault(); moveSelection('left'); break
    case 'ArrowRight': e.preventDefault(); moveSelection('right'); break
    case 'ArrowUp': e.preventDefault(); moveSelection('up'); break
    case 'ArrowDown': e.preventDefault(); moveSelection('down'); break
    case 'Escape': appState.selectedId = null; rerender(); break
  }
}

// ---------- mouse: drag node / draw edge / pan ----------

function flashRed(nodeId) {
  const el = document.querySelector(`.node[data-id="${nodeId}"]`)
  if (!el) return
  el.classList.add('flash-red')
  setTimeout(() => el.classList.remove('flash-red'), 900)
}

function startNodeDrag(e, nodeEl) {
  const id = nodeEl.dataset.id
  const startMouse = screenToWorld(e.clientX, e.clientY)
  const startLeft = parseFloat(nodeEl.style.left)
  const startTop = parseFloat(nodeEl.style.top)
  let moved = false

  function onMove(ev) {
    const current = screenToWorld(ev.clientX, ev.clientY)
    const dx = current.x - startMouse.x
    const dy = current.y - startMouse.y
    if (!moved && Math.hypot(dx, dy) * appState.zoom < 4) return
    moved = true
    nodeEl.style.left = startLeft + dx + 'px'
    nodeEl.style.top = startTop + dy + 'px'
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (moved) {
      const current = screenToWorld(ev.clientX, ev.clientY)
      setGoal(updateNode(appState.goal, id, {
        x: startLeft + (current.x - startMouse.x),
        y: startTop + (current.y - startMouse.y)
      }))
    } else {
      selectNode(id)
    }
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function startEdgeDrag(e, fromId) {
  const svg = document.getElementById('edges')
  const temp = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  temp.id = 'templine'
  svg.appendChild(temp)
  const fromPos = appState.lastPositions.get(fromId)
  const x1 = fromPos.x + NODE_W
  const y1 = fromPos.y + NODE_H / 2

  function onMove(ev) {
    const p = screenToWorld(ev.clientX, ev.clientY)
    const dx = Math.max(40, (p.x - x1) / 2)
    temp.setAttribute('d', `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${p.x - dx} ${p.y}, ${p.x} ${p.y}`)
  }
  function onUp(ev) {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
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
  const pickExisting = window.confirm(
    '绑定数据文件：\n「确定」= 选择已有的数据文件（采用文件中的数据）\n「取消」= 创建新的数据文件（写入当前数据）')
  try {
    const adopted = await bindFile(appState.store, pickExisting)
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
  if (!window.confirm('清除所有手动调整的位置，恢复自动布局？')) return
  let next = appState.goal
  for (const node of next.nodes) {
    if (node.x !== null || node.y !== null) {
      next = updateNode(next, node.id, { x: null, y: null })
    }
  }
  setGoal(next)
}

// ---------- wiring ----------

export function setupInteractions() {
  const canvas = document.getElementById('canvas')
  const nodes = document.getElementById('nodes')

  document.addEventListener('keydown', onKeydown)
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
    if (e.target.closest('.detail-panel')) return
    if (isTextTarget(e.target) || e.target.tagName === 'BUTTON') return
    const nodeEl = e.target.closest('.node')
    if (nodeEl) startNodeDrag(e, nodeEl)
  })

  nodes.addEventListener('dblclick', e => {
    if (isTextTarget(e.target) || e.target.closest('.detail-panel')) return
    const card = e.target.closest('.card')
    if (card) startEditing(card.dataset.id)
  })

  nodes.addEventListener('click', e => {
    const collapseBtn = e.target.closest('.collapse-btn')
    if (collapseBtn) {
      const id = collapseBtn.dataset.id
      const node = appState.goal.nodes.find(n => n.id === id)
      setGoal(updateNode(appState.goal, id, { collapsed: !node.collapsed }))
      return
    }
    const detailBtn = e.target.closest('.detail-btn')
    if (detailBtn) {
      const id = detailBtn.dataset.id
      const node = appState.goal.nodes.find(n => n.id === id)
      appState.selectedId = id
      setGoal(updateNode(appState.goal, id, { detailOpen: !node.detailOpen }))
      return
    }
    const prereq = e.target.closest('.prereq-item')
    if (prereq) {
      selectNode(prereq.dataset.target)
      ensureVisible(prereq.dataset.target)
    }
  })

  nodes.addEventListener('change', e => {
    const id = e.target.dataset.id
    if (!id) return
    if (e.target.classList.contains('f-description')) {
      setGoal(updateNode(appState.goal, id, { description: e.target.value }))
    } else if (e.target.classList.contains('f-status')) {
      setGoal(updateNode(appState.goal, id, { status: e.target.value }))
    } else if (e.target.classList.contains('f-hours')) {
      const value = e.target.value === '' ? null : Number(e.target.value)
      setGoal(updateNode(appState.goal, id, { estimatedHours: value }))
    } else if (e.target.classList.contains('f-deadline')) {
      setGoal(updateNode(appState.goal, id, { deadline: e.target.value || null }))
    }
  })

  nodes.addEventListener('focusout', e => {
    if (e.target.classList.contains('title-input')) commitEdit(e.target)
  })

  document.getElementById('edges').addEventListener('contextmenu', e => {
    const hit = e.target.closest('.edge-hit')
    if (!hit) return
    e.preventDefault()
    if (window.confirm('删除这条依赖？')) {
      setGoal(removeEdge(appState.goal, hit.dataset.from, hit.dataset.to))
    }
  })

  document.getElementById('goalTitle').addEventListener('change', e => {
    const title = e.target.value.trim() || appState.goal.title
    setStore(renameCurrentGoal(appState.store, title))
  })
  document.getElementById('goalSelect').addEventListener('change', e => {
    setStore(switchGoal(appState.store, e.target.value))
  })
  document.getElementById('btnNewGoal').addEventListener('click', () => {
    const name = window.prompt('新 Goal 的名称：', '新目标')
    if (name === null) return
    setStore(addGoal(appState.store, createGoal(name.trim() || '新目标')))
  })
  document.getElementById('btnDeleteGoal').addEventListener('click', () => {
    if (appState.store.goals.length === 1) {
      window.alert('至少保留一个 Goal，无法删除')
      return
    }
    if (!window.confirm(`删除整个 Goal「${appState.goal.title}」及其全部任务？此操作不可恢复。`)) return
    setStore(removeGoal(appState.store, appState.store.currentId))
  })
  document.getElementById('btnBindFile').addEventListener('click', handleBindFile)
  document.getElementById('fileStatus').addEventListener('click', async () => {
    if (!window.confirm('解除数据文件绑定？（文件保留，此后更改只存在浏览器本地）')) return
    await unbindFile()
    rerender()
  })
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
  document.getElementById('btnLayout').addEventListener('click', resetLayout)
  document.getElementById('btnExport').addEventListener('click', downloadExport)
  document.getElementById('importFile').addEventListener('change', e => {
    if (e.target.files[0]) handleImportFile(e.target.files[0])
    e.target.value = ''
  })
  document.getElementById('btnZoomReset').addEventListener('click', () => {
    appState.zoom = 1
    appState.pan = { x: 80, y: Math.round(document.getElementById('canvas').clientHeight / 2) }
    updateTransform()
  })
}
