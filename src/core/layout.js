export function computeLayers(goal, visibleIds) {
  const layers = new Map()
  const visible = goal.nodes.filter(n => visibleIds.has(n.id))
  const pending = new Set(visible.map(n => n.id))
  layers.set('root', 0)
  pending.delete('root')

  while (pending.size > 0) {
    let progressed = false
    for (const id of [...pending]) {
      const parents = goal.edges
        .filter(e => e.from === id && visibleIds.has(e.to))
        .map(e => e.to)
      if (parents.length === 0) {
        layers.set(id, 1)
        pending.delete(id)
        progressed = true
        continue
      }
      if (parents.every(p => layers.has(p))) {
        layers.set(id, Math.max(...parents.map(p => layers.get(p))) + 1)
        pending.delete(id)
        progressed = true
      }
    }
    // cycles cannot occur (guarded at edge creation), but stay safe
    if (!progressed) {
      for (const id of pending) layers.set(id, 1)
      break
    }
  }
  return layers
}

// Outline-tree layout (mind-map style):
// - each node is top-aligned with its first child
// - siblings stack vertically in the same column (depth * gapX)
// - a subtree pushes the next sibling below its full extent
// Edges are stored as child -> parent. The DAG is treed by "primary parent":
// the first visible outgoing edge from a child node.
export function autoLayout(goal, visibleIds, opts = {}) {
  const { gapX = 260, gapY = 90, detailHeights = {} } = opts
  const pos = new Map()

  const primaryParent = new Map()
  for (const node of goal.nodes) {
    if (!visibleIds.has(node.id)) continue
    const first = goal.edges.find(e => e.from === node.id && visibleIds.has(e.to))
    if (first) primaryParent.set(node.id, first.to)
  }
  const treeChildren = id => goal.edges
    .filter(e => e.to === id && visibleIds.has(e.from) && primaryParent.get(e.from) === id)
    .map(e => e.from)

  // per-column cursors: a node only needs to clear its OWN column,
  // so it rises as high as possible even when deeper subtrees extend far down
  const colCursor = []
  let floor = 0
  const cur = depth => Math.max(colCursor[depth] ?? 0, floor)

  // minY carries the parent's column constraint down the first-child chain,
  // so the whole chain settles at max(cursors of all its columns) — exactly
  // top-aligned, and as high as those columns allow.
  function layoutSubtree(id, depth, minY) {
    const kids = treeChildren(id)
    let y
    if (kids.length === 0) {
      y = Math.max(minY, cur(depth))
    } else {
      y = layoutSubtree(kids[0], depth + 1, Math.max(minY, cur(depth)))
      for (const kid of kids.slice(1)) layoutSubtree(kid, depth + 1, 0)
    }
    pos.set(id, { x: depth * gapX, y })
    colCursor[depth] = y + gapY + (detailHeights[id] || 0)
    return y
  }

  layoutSubtree('root', 0, 0)
  // orphans (no visible parent) become extra roots in column 1, below everything
  let maxY = 0
  for (const p of pos.values()) maxY = Math.max(maxY, p.y)
  floor = maxY + gapY
  for (const node of goal.nodes) {
    if (node.id === 'root' || !visibleIds.has(node.id)) continue
    if (!primaryParent.has(node.id) && !pos.has(node.id)) {
      layoutSubtree(node.id, 1, floor)
      for (const p of pos.values()) maxY = Math.max(maxY, p.y)
      floor = maxY + gapY
    }
  }
  return pos
}

// Sibling order in autoLayout follows edge order. To make layout honor the
// user's vertical placement, rewrite each parent's outgoing edges sorted by
// the child's current y. Edges keep their group's original slots in the array,
// so edges from different parents never swap relative order.
export function reorderChildEdges(goal, parentId, orderedChildIds) {
  const rank = new Map(orderedChildIds.map((id, i) => [id, i]))
  const group = goal.edges.filter(e => e.to === parentId && rank.has(e.from))
  if (group.length < 2) return goal
  const sorted = [...group].sort((a, b) => rank.get(a.from) - rank.get(b.from))
  let i = 0
  const edges = goal.edges.map(e =>
    (e.to === parentId && rank.has(e.from)) ? sorted[i++] : e)
  return { ...goal, edges }
}

export function reorderEdgesByPlacement(goal, positions) {
  const parents = [...new Set(goal.edges.map(e => e.to))]
  return parents.reduce((acc, parent) => {
    const kids = acc.edges.filter(e => e.to === parent).map(e => e.from)
    const ordered = kids
      .map((id, i) => ({ id, i, y: positions.get(id)?.y }))
      .sort((a, b) => (a.y ?? Infinity) - (b.y ?? Infinity) || a.i - b.i)
      .map(k => k.id)
    return reorderChildEdges(acc, parent, ordered)
  }, goal)
}

export function normalizeEdgeDirections(goal) {
  const alreadyCanonical = goal.edgeDirection === 'child-to-parent'
    || (goal.edges.some(e => e.to === 'root') && !goal.edges.some(e => e.from === 'root'))
  const seen = new Set()
  const edges = []
  for (const edge of goal.edges) {
    const normalized = alreadyCanonical || edge.visualDirection === 'forward'
      ? { ...edge }
      : { ...edge, from: edge.to, to: edge.from }
    delete normalized.visualDirection
    const key = `${normalized.from}→${normalized.to}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(normalized)
  }
  return { ...goal, edgeDirection: 'child-to-parent', edges }
}

export function reorderEdgesByReference(goal, referenceGoal) {
  if (!referenceGoal) return goal
  const reference = normalizeEdgeDirections(referenceGoal)
  const parents = [...new Set(goal.edges.map(e => e.to))]
  return parents.reduce((acc, parent) => {
    const refOrder = reference.edges
      .filter(e => e.to === parent)
      .map(e => e.from)
    if (refOrder.length === 0) return acc
    const rank = new Map(refOrder.map((id, i) => [id, i]))
    const kids = acc.edges.filter(e => e.to === parent).map(e => e.from)
    const ordered = kids
      .map((id, i) => ({ id, i, rank: rank.get(id) }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.i - b.i)
      .map(k => k.id)
    return reorderChildEdges(acc, parent, ordered)
  }, goal)
}

export function normalizeLayoutGoal(goal, { positions = null, referenceGoal = null } = {}) {
  let next = reorderEdgesByReference(normalizeEdgeDirections(goal), referenceGoal)
  if (positions) next = reorderEdgesByPlacement(next, positions)

  const connected = new Set(['root'])
  for (const edge of next.edges) {
    connected.add(edge.from)
    connected.add(edge.to)
  }

  return {
    ...next,
    nodes: next.nodes.map(node => {
      if (!connected.has(node.id)) return node
      if (node.x === null && node.y === null) return node
      return { ...node, x: null, y: null }
    })
  }
}

function manuallyPositionedIds(goal) {
  const connected = new Set(['root'])
  for (const edge of goal.edges) {
    connected.add(edge.from)
    connected.add(edge.to)
  }
  return new Set(goal.nodes
    .filter(node => !connected.has(node.id) && node.x !== null && node.y !== null)
    .map(node => node.id))
}

export function resolvePositions(goal, autoPos) {
  const resolved = new Map()
  const manual = manuallyPositionedIds(goal)
  for (const node of goal.nodes) {
    if (manual.has(node.id)) {
      resolved.set(node.id, { x: node.x, y: node.y })
    } else if (autoPos.has(node.id)) {
      resolved.set(node.id, autoPos.get(node.id))
    }
  }
  return resolved
}
