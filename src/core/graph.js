export function predecessorsOf(goal, id) {
  const ids = goal.edges.filter(e => e.to === id).map(e => e.from)
  return goal.nodes.filter(n => ids.includes(n.id))
}

export function successorsOf(goal, id) {
  const ids = goal.edges.filter(e => e.from === id).map(e => e.to)
  return goal.nodes.filter(n => ids.includes(n.id))
}

export function wouldCreateCycle(goal, from, to) {
  if (from === to) return true
  // adding from→to creates a cycle iff `from` is reachable from `to`
  const visited = new Set()
  const stack = [to]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === from) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const e of goal.edges) {
      if (e.from === current) stack.push(e.to)
    }
  }
  return false
}

// A node's prerequisites are its sub-steps: the successors it points to.
// The node itself can start once every sub-step is done.
export function isReady(goal, id) {
  const node = goal.nodes.find(n => n.id === id)
  if (!node || node.type === 'goal' || node.status !== 'todo') return false
  return successorsOf(goal, id).every(s => s.status === 'done')
}

// Collapsing a node folds its prerequisite subtree: a node is hidden when
// every path leading into it comes from a collapsed or already-hidden node.
function computeHidden(goal, collapsedIds) {
  const hidden = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const node of goal.nodes) {
      if (node.id === 'root' || hidden.has(node.id)) continue
      const preds = goal.edges.filter(e => e.to === node.id).map(e => e.from)
      if (preds.length === 0) continue
      const allAbsorbed = preds.every(p => collapsedIds.has(p) || hidden.has(p))
      if (allAbsorbed) {
        hidden.add(node.id)
        changed = true
      }
    }
  }
  return hidden
}

export function hiddenByCollapse(goal) {
  const collapsedIds = new Set(goal.nodes.filter(n => n.collapsed).map(n => n.id))
  if (collapsedIds.size === 0) return new Set()
  return computeHidden(goal, collapsedIds)
}

export function collapsedCount(goal, id) {
  const seen = new Set()
  const stack = goal.edges.filter(e => e.from === id).map(e => e.to)
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    for (const edge of goal.edges) {
      if (edge.from === nodeId) stack.push(edge.to)
    }
  }
  return seen.size
}
