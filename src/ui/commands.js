import {
  addEdge, addNode, removeNode, updateNode
} from '../core/model.js'
import { successorsOf } from '../core/graph.js'
import { reorderChildEdges } from '../core/layout.js'

const STATUS_CYCLE = { todo: 'doing', doing: 'done', done: 'todo' }

function lastNodeId(goal) {
  return goal.nodes[goal.nodes.length - 1].id
}

export function createSuccessorCommand(goal, selectedId) {
  if (!selectedId) return null
  const parent = goal.nodes.find(n => n.id === selectedId)
  if (!parent) return null
  const type = parent.type === 'goal' ? 'project' : 'task'
  let next = addNode(goal, { title: '', type })
  const nodeId = lastNodeId(next)
  next = addEdge(next, nodeId, selectedId)
  return { goal: next, nodeId }
}

export function createParallelCommand(goal, selectedId) {
  if (!selectedId || selectedId === 'root') return null
  const current = goal.nodes.find(n => n.id === selectedId)
  if (!current) return null
  const parents = successorsOf(goal, selectedId)
  let next = addNode(goal, { title: '', type: current.type })
  const nodeId = lastNodeId(next)
  for (const parent of parents) next = addEdge(next, nodeId, parent.id)
  for (const parent of parents) {
    const siblings = next.edges
      .filter(e => e.to === parent.id)
      .map(e => e.from)
    const ordered = []
    for (const id of siblings) {
      if (id === nodeId) continue
      ordered.push(id)
      if (id === selectedId) ordered.push(nodeId)
    }
    if (!ordered.includes(nodeId)) ordered.push(nodeId)
    next = reorderChildEdges(next, parent.id, ordered)
  }
  return { goal: next, nodeId }
}

export function createFloatingCommand(goal, worldPos) {
  let next = addNode(goal, { title: '', type: 'task' })
  const nodeId = lastNodeId(next)
  next = updateNode(next, nodeId, { x: worldPos.x, y: worldPos.y })
  return { goal: next, nodeId }
}

export function deleteNodesCommand(goal, ids) {
  const deletable = [...new Set(ids)].filter(id => id && id !== 'root')
  return deletable.reduce((next, id) => removeNode(next, id), goal)
}

export function setNodeTitleCommand(goal, id, title) {
  let next = updateNode(goal, id, { title })
  if (id === 'root') next = { ...next, title }
  return next
}

export function cycleNodeStatusCommand(goal, id) {
  if (!id || id === 'root') return goal
  const node = goal.nodes.find(n => n.id === id)
  if (!node) return goal
  return updateNode(goal, id, { status: STATUS_CYCLE[node.status] })
}
