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

describe('autoLayout (outline tree style)', () => {
  it('top-aligns each node with its first child; siblings stack below in the same column', () => {
    const { goal, ids } = buildDiamond()
    const pos = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    // columns follow tree depth (D's primary parent is B — the first edge into it)
    expect(pos.get('root').x).toBe(0)
    expect(pos.get(ids.A).x).toBe(260)
    expect(pos.get(ids.B).x).toBe(520)
    expect(pos.get(ids.C).x).toBe(520)
    expect(pos.get(ids.D).x).toBe(780)
    // top alignment down the first-child chain: root = A = B = D
    expect(pos.get(ids.A).y).toBe(pos.get('root').y)
    expect(pos.get(ids.B).y).toBe(pos.get(ids.A).y)
    expect(pos.get(ids.D).y).toBe(pos.get(ids.B).y)
    // sibling C sits one row below B in the same column
    expect(pos.get(ids.C).y).toBe(pos.get(ids.B).y + 90)
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

  it('compacts: a node rises as long as its own column is free, ignoring deeper subtree extent', () => {
    // root → A → (B, C); root → E. A 的子树占用了更深的列，
    // 但 E 所在的列（与 A 同列）只有 A 一个，E 应紧贴 A 下方而不是整棵子树下方。
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'B', 'C', 'E']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, 'root', ids.A)
    goal = addEdge(goal, ids.A, ids.B)
    goal = addEdge(goal, ids.A, ids.C)
    goal = addEdge(goal, 'root', ids.E)
    const pos = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    expect(pos.get(ids.A).y).toBe(pos.get(ids.B).y)
    expect(pos.get(ids.C).y).toBe(pos.get(ids.B).y + 90)
    expect(pos.get(ids.E).x).toBe(260) // same column as A
    expect(pos.get(ids.E).y).toBe(pos.get(ids.A).y + 90) // tucked right below A
  })

  it('first-child top alignment is a hard constraint: the whole chain moves down together', () => {
    // root → A, root → G (fill column 1 down to y=180), then root → E → F.
    // E is forced to y=180 by its own column; F must come down WITH it, not stay at 0.
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'G', 'E', 'F']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, 'root', ids.A)
    goal = addEdge(goal, 'root', ids.G)
    goal = addEdge(goal, 'root', ids.E)
    goal = addEdge(goal, ids.E, ids.F)
    const pos = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    expect(pos.get(ids.E).y).toBe(180) // below A(0) and G(90)
    expect(pos.get(ids.F).y).toBe(pos.get(ids.E).y) // aligned, pulled down together
  })

  it('never lifts a later sibling above an earlier one in the same column', () => {
    // root → (A, E); A → B. E shares A's column and must stay below A.
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'B', 'E']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, 'root', ids.A)
    goal = addEdge(goal, ids.A, ids.B)
    goal = addEdge(goal, 'root', ids.E)
    const pos = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    expect(pos.get(ids.E).y).toBeGreaterThan(pos.get(ids.A).y)
  })

  it('places orphan nodes in column 1 below the root tree', () => {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'lone', type: 'task' })
    const id = goal.nodes[1].id
    const pos = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    expect(pos.get(id).x).toBe(260)
    expect(pos.get(id).y).toBeGreaterThan(pos.get('root').y)
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
