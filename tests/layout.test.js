import { describe, it, expect } from 'vitest'
import { createGoal, addNode, addEdge, updateNode } from '../src/core/model.js'
import { computeLayers, autoLayout, resolvePositions } from '../src/core/layout.js'

// Diamond: root → A; A → B; A → C; B → D; C → D
function buildDiamond() {
  let goal = createGoal('G')
  const ids = {}
  for (const name of ['A', 'B', 'C', 'D']) {
    goal = addNode(goal, { title: name, type: 'task' })
    ids[name] = goal.nodes[goal.nodes.length - 1].id
  }
  goal = addEdge(goal, 'root', ids.A)
  goal = addEdge(goal, ids.A, ids.B)
  goal = addEdge(goal, ids.A, ids.C)
  goal = addEdge(goal, ids.B, ids.D)
  goal = addEdge(goal, ids.C, ids.D)
  return { goal, ids }
}

function allVisible(goal) {
  return new Set(goal.nodes.map(n => n.id))
}

describe('computeLayers', () => {
  it('assigns layers as max(pred layer) + 1', () => {
    const { goal, ids } = buildDiamond()
    const layers = computeLayers(goal, allVisible(goal))
    expect(layers.get('root')).toBe(0)
    expect(layers.get(ids.A)).toBe(1)
    expect(layers.get(ids.B)).toBe(1 + 1)
    expect(layers.get(ids.C)).toBe(2)
    expect(layers.get(ids.D)).toBe(3)
  })

  it('puts orphan (no visible predecessor) nodes at layer 1', () => {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'lone', type: 'task' })
    const id = goal.nodes[1].id
    const layers = computeLayers(goal, allVisible(goal))
    expect(layers.get(id)).toBe(1)
  })

  it('ignores hidden nodes entirely', () => {
    const { goal, ids } = buildDiamond()
    const visible = allVisible(goal)
    visible.delete(ids.B)
    const layers = computeLayers(goal, visible)
    expect(layers.has(ids.B)).toBe(false)
    // D's only visible pred is C (layer 2) → D at 3
    expect(layers.get(ids.D)).toBe(3)
  })
})

describe('autoLayout', () => {
  it('positions layers left-to-right with stacked rows', () => {
    const { goal, ids } = buildDiamond()
    const pos = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    expect(pos.get('root').x).toBe(0)
    expect(pos.get(ids.A).x).toBe(260)
    expect(pos.get(ids.B).x).toBe(520)
    expect(pos.get(ids.C).x).toBe(520)
    expect(pos.get(ids.D).x).toBe(780)
    // B and C share a layer → distinct stacked y
    expect(pos.get(ids.B).y).not.toBe(pos.get(ids.C).y)
    // single-node layers are vertically centered relative to the two-node layer
    const midBC = (pos.get(ids.B).y + pos.get(ids.C).y) / 2
    expect(pos.get(ids.A).y).toBeCloseTo(midBC, 5)
  })

  it('reserves extra height for open detail panels', () => {
    const { goal, ids } = buildDiamond()
    const base = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    const withDetail = autoLayout(goal, allVisible(goal), {
      gapX: 260, gapY: 90, detailHeights: { [ids.B]: 200 }
    })
    const gapBase = base.get(ids.C).y - base.get(ids.B).y
    const gapDetail = withDetail.get(ids.C).y - withDetail.get(ids.B).y
    expect(gapDetail - gapBase).toBe(200)
  })
})

describe('resolvePositions', () => {
  it('prefers manual x/y over auto positions', () => {
    let { goal, ids } = buildDiamond()
    goal = updateNode(goal, ids.B, { x: 999, y: 111 })
    const auto = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    const resolved = resolvePositions(goal, auto)
    expect(resolved.get(ids.B)).toEqual({ x: 999, y: 111 })
    expect(resolved.get(ids.C)).toEqual(auto.get(ids.C))
  })
})
