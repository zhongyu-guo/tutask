let idCounter = 0

export function genId() {
  idCounter += 1
  return 'n' + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 7)
}

function findNode(goal, id) {
  return goal.nodes.find(n => n.id === id)
}

export function createGoal(title) {
  return {
    title,
    nodes: [{
      id: 'root', type: 'goal', title,
      status: 'todo', description: '', estimatedHours: null, deadline: null,
      x: null, y: null, collapsed: false, detailOpen: false
    }],
    edges: []
  }
}

export function addNode(goal, { title, type }) {
  const node = {
    id: genId(), type, title,
    status: 'todo', description: '', estimatedHours: null, deadline: null,
    x: null, y: null, collapsed: false, detailOpen: false
  }
  return { ...goal, nodes: [...goal.nodes, node] }
}

export function updateNode(goal, id, patch) {
  if (!findNode(goal, id)) throw new Error(`Node not found: ${id}`)
  return {
    ...goal,
    nodes: goal.nodes.map(n => (n.id === id ? { ...n, ...patch, id: n.id } : n))
  }
}

export function removeNode(goal, id) {
  if (id === 'root') throw new Error('Cannot remove the goal root node')
  if (!findNode(goal, id)) throw new Error(`Node not found: ${id}`)
  return {
    ...goal,
    nodes: goal.nodes.filter(n => n.id !== id),
    edges: goal.edges.filter(e => e.from !== id && e.to !== id)
  }
}

export function addEdge(goal, from, to) {
  if (from === to) throw new Error('Self-loop edges are not allowed')
  if (!findNode(goal, from)) throw new Error(`Node not found: ${from}`)
  if (!findNode(goal, to)) throw new Error(`Node not found: ${to}`)
  if (goal.edges.some(e => e.from === from && e.to === to)) {
    throw new Error('Edge already exists')
  }
  return { ...goal, edges: [...goal.edges, { from, to }] }
}

export function removeEdge(goal, from, to) {
  return { ...goal, edges: goal.edges.filter(e => !(e.from === from && e.to === to)) }
}
