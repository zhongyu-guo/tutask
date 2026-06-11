export function computeLayers(goal, visibleIds) {
  const layers = new Map()
  const visible = goal.nodes.filter(n => visibleIds.has(n.id))
  const pending = new Set(visible.map(n => n.id))
  layers.set('root', 0)
  pending.delete('root')

  while (pending.size > 0) {
    let progressed = false
    for (const id of [...pending]) {
      const preds = goal.edges
        .filter(e => e.to === id && visibleIds.has(e.from))
        .map(e => e.from)
      if (preds.length === 0) {
        layers.set(id, 1)
        pending.delete(id)
        progressed = true
        continue
      }
      if (preds.every(p => layers.has(p))) {
        layers.set(id, Math.max(...preds.map(p => layers.get(p))) + 1)
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
// The DAG is treed by "primary parent": the first visible edge into a node.
export function autoLayout(goal, visibleIds, opts = {}) {
  const { gapX = 260, gapY = 90, detailHeights = {} } = opts
  const pos = new Map()

  const primaryParent = new Map()
  for (const node of goal.nodes) {
    if (!visibleIds.has(node.id)) continue
    const first = goal.edges.find(e => e.to === node.id && visibleIds.has(e.from))
    if (first) primaryParent.set(node.id, first.from)
  }
  const treeChildren = id => goal.edges
    .filter(e => e.from === id && visibleIds.has(e.to) && primaryParent.get(e.to) === id)
    .map(e => e.to)

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

export function resolvePositions(goal, autoPos) {
  const resolved = new Map()
  for (const node of goal.nodes) {
    if (node.x !== null && node.y !== null) {
      resolved.set(node.id, { x: node.x, y: node.y })
    } else if (autoPos.has(node.id)) {
      resolved.set(node.id, autoPos.get(node.id))
    }
  }
  return resolved
}
