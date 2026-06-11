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

export function autoLayout(goal, visibleIds, opts = {}) {
  const { gapX = 260, gapY = 90, detailHeights = {} } = opts
  const layers = computeLayers(goal, visibleIds)

  const byLayer = new Map()
  for (const [id, layer] of layers) {
    if (!byLayer.has(layer)) byLayer.set(layer, [])
    byLayer.get(layer).push(id)
  }
  const layerNums = [...byLayer.keys()].sort((a, b) => a - b)

  // barycenter ordering: sort each layer by mean predecessor row index, 2 passes
  const rowIndex = new Map()
  for (const layer of layerNums) {
    byLayer.get(layer).forEach((id, i) => rowIndex.set(id, i))
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const layer of layerNums) {
      const ids = byLayer.get(layer)
      const keyed = ids.map(id => {
        const preds = goal.edges
          .filter(e => e.to === id && rowIndex.has(e.from))
          .map(e => rowIndex.get(e.from))
        const key = preds.length > 0
          ? preds.reduce((a, b) => a + b, 0) / preds.length
          : rowIndex.get(id)
        return { id, key }
      })
      keyed.sort((a, b) => a.key - b.key)
      byLayer.set(layer, keyed.map(k => k.id))
      keyed.forEach((k, i) => rowIndex.set(k.id, i))
    }
  }

  // assign y by stacking (detail panels take extra height), center each layer
  const pos = new Map()
  const layerHeights = new Map()
  for (const layer of layerNums) {
    const ids = byLayer.get(layer)
    let total = 0
    for (const id of ids) total += gapY + (detailHeights[id] || 0)
    layerHeights.set(layer, total)
  }
  for (const layer of layerNums) {
    const ids = byLayer.get(layer)
    const height = layerHeights.get(layer)
    let y = -height / 2
    for (const id of ids) {
      pos.set(id, { x: layer * gapX, y })
      y += gapY + (detailHeights[id] || 0)
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
