import { describe, it, expect } from 'vitest'
import { createGoal, addNode, addEdge, updateNode } from '../src/core/model.js'
import {
  computeLayers, autoLayout, resolvePositions,
  reorderChildEdges, reorderEdgesByPlacement,
  reorderEdgesByReference, normalizeLayoutGoal
} from '../src/core/layout.js'

// Diamond with child -> parent edges: A → root; B/C → A; D → B/C
function buildDiamond() {
  let goal = createGoal('G')
  const ids = {}
  for (const name of ['A', 'B', 'C', 'D']) {
    goal = addNode(goal, { title: name, type: 'task' })
    ids[name] = goal.nodes[goal.nodes.length - 1].id
  }
  goal = addEdge(goal, ids.A, 'root')
  goal = addEdge(goal, ids.B, ids.A)
  goal = addEdge(goal, ids.C, ids.A)
  goal = addEdge(goal, ids.D, ids.B)
  goal = addEdge(goal, ids.D, ids.C)
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
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.B, ids.A)
    goal = addEdge(goal, ids.C, ids.A)
    goal = addEdge(goal, ids.E, 'root')
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
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.G, 'root')
    goal = addEdge(goal, ids.E, 'root')
    goal = addEdge(goal, ids.F, ids.E)
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
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.B, ids.A)
    goal = addEdge(goal, ids.E, 'root')
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

describe('reorderChildEdges', () => {
  it('reorders one parent’s outgoing edges to match the given child order, immutably', () => {
    const { goal, ids } = buildDiamond()
    const next = reorderChildEdges(goal, ids.A, [ids.C, ids.B])
    // A's child edges flipped, others untouched
    const aKids = next.edges.filter(e => e.to === ids.A).map(e => e.from)
    expect(aKids).toEqual([ids.C, ids.B])
    expect(next.edges.filter(e => e.to !== ids.A))
      .toEqual(goal.edges.filter(e => e.to !== ids.A))
    // original goal not mutated
    expect(goal.edges.filter(e => e.to === ids.A).map(e => e.from)).toEqual([ids.B, ids.C])
  })

  it('keeps each group edge in the from-group’s original slots', () => {
    const { goal, ids } = buildDiamond()
    const next = reorderChildEdges(goal, ids.A, [ids.C, ids.B])
    // global slot indices of A's child edges are unchanged (only contents swapped)
    const slots = g => g.edges.map((e, i) => (e.to === ids.A ? i : null)).filter(i => i !== null)
    expect(slots(next)).toEqual(slots(goal))
  })
})

describe('reorderEdgesByPlacement', () => {
  it('orders siblings by their current vertical position', () => {
    // A → root, E → root in edge order; user moved E above A
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'E']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.E, 'root')
    const positions = new Map([
      ['root', { x: 0, y: 0 }],
      [ids.A, { x: 260, y: 200 }],
      [ids.E, { x: 260, y: 10 }]
    ])
    const next = reorderEdgesByPlacement(goal, positions)
    expect(next.edges.map(e => e.from)).toEqual([ids.E, ids.A])
    // autoLayout now puts E on top
    const pos = autoLayout(next, allVisible(next), { gapX: 260, gapY: 90 })
    expect(pos.get(ids.E).y).toBeLessThan(pos.get(ids.A).y)
  })

  it('keeps edge order stable for nodes without a known position', () => {
    const { goal, ids } = buildDiamond()
    const next = reorderEdgesByPlacement(goal, new Map())
    expect(next.edges).toEqual(goal.edges)
  })
})

describe('reorderEdgesByReference', () => {
  it('orders matching sibling edges by another goal snapshot', () => {
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'B', 'C']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.B, 'root')
    goal = addEdge(goal, ids.C, 'root')
    const reference = reorderChildEdges(goal, 'root', [ids.C, ids.A, ids.B])

    const next = reorderEdgesByReference(goal, reference)
    expect(next.edges.filter(e => e.to === 'root').map(e => e.from))
      .toEqual([ids.C, ids.A, ids.B])
  })

  it('keeps new children after referenced children in their current order', () => {
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'B', 'C']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.B, 'root')
    goal = addEdge(goal, ids.C, 'root')
    const reference = reorderChildEdges(goal, 'root', [ids.B, ids.A])

    const next = reorderEdgesByReference(goal, reference)
    expect(next.edges.filter(e => e.to === 'root').map(e => e.from))
      .toEqual([ids.B, ids.A, ids.C])
  })
})

describe('normalizeLayoutGoal', () => {
  it('clears saved positions from connected graph nodes but keeps isolated floating nodes', () => {
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'B', 'Floating']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.B, ids.A)
    goal = updateNode(goal, 'root', { x: 10, y: 20 })
    goal = updateNode(goal, ids.A, { x: 100, y: 200 })
    goal = updateNode(goal, ids.B, { x: 300, y: 400 })
    goal = updateNode(goal, ids.Floating, { x: 500, y: 600 })

    const next = normalizeLayoutGoal(goal)
    expect(next.nodes.find(n => n.id === 'root')).toMatchObject({ x: null, y: null })
    expect(next.nodes.find(n => n.id === ids.A)).toMatchObject({ x: null, y: null })
    expect(next.nodes.find(n => n.id === ids.B)).toMatchObject({ x: null, y: null })
    expect(next.nodes.find(n => n.id === ids.Floating)).toMatchObject({ x: 500, y: 600 })
  })

  it('can bake current vertical placement into edge order before clearing positions', () => {
    let goal = createGoal('G')
    const ids = {}
    for (const name of ['A', 'B']) {
      goal = addNode(goal, { title: name, type: 'task' })
      ids[name] = goal.nodes[goal.nodes.length - 1].id
    }
    goal = addEdge(goal, ids.A, 'root')
    goal = addEdge(goal, ids.B, 'root')
    goal = updateNode(goal, ids.A, { x: 260, y: 200 })
    goal = updateNode(goal, ids.B, { x: 260, y: 0 })

    const next = normalizeLayoutGoal(goal, {
      positions: new Map([
        [ids.A, { x: 260, y: 200 }],
        [ids.B, { x: 260, y: 0 }]
      ])
    })
    expect(next.edges.map(e => e.from)).toEqual([ids.B, ids.A])
    expect(next.nodes.find(n => n.id === ids.A)).toMatchObject({ x: null, y: null })
    expect(next.nodes.find(n => n.id === ids.B)).toMatchObject({ x: null, y: null })
  })
})

describe('resolvePositions', () => {
  it('ignores saved x/y for connected nodes', () => {
    let { goal, ids } = buildDiamond()
    goal = updateNode(goal, ids.B, { x: 999, y: 111 })
    const auto = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    const resolved = resolvePositions(goal, auto)
    expect(resolved.get(ids.B)).toEqual(auto.get(ids.B))
    expect(resolved.get(ids.C)).toEqual(auto.get(ids.C))
  })

  it('keeps manual x/y for isolated floating nodes', () => {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'Floating', type: 'task' })
    const id = goal.nodes[1].id
    goal = updateNode(goal, id, { x: 999, y: 111 })
    const auto = autoLayout(goal, allVisible(goal), { gapX: 260, gapY: 90 })
    const resolved = resolvePositions(goal, auto)
    expect(resolved.get(id)).toEqual({ x: 999, y: 111 })
  })
})
