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

export function isReady(goal, id) {
  const node = goal.nodes.find(n => n.id === id)
  if (!node || node.type === 'goal' || node.status !== 'todo') return false
  return predecessorsOf(goal, id)
    .filter(p => p.type !== 'goal')
    .every(p => p.status === 'done')
}

function computeHidden(goal, collapsedIds) {
  const hidden = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const node of goal.nodes) {
      if (node.id === 'root' || hidden.has(node.id) || collapsedIds.has(node.id)) continue
      const successors = goal.edges.filter(e => e.from === node.id).map(e => e.to)
      if (successors.length === 0) continue
      const allAbsorbed = successors.every(s => collapsedIds.has(s) || hidden.has(s))
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
  const all = hiddenByCollapse(goal)
  const othersCollapsed = new Set(
    goal.nodes.filter(n => n.collapsed && n.id !== id).map(n => n.id)
  )
  const withoutThis = computeHidden(goal, othersCollapsed)
  let count = 0
  for (const nodeId of all) {
    if (!withoutThis.has(nodeId)) count += 1
  }
  return count
}
