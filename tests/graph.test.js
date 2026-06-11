import { describe, it, expect } from 'vitest'
import { createGoal, addNode, addEdge, updateNode } from '../src/core/model.js'
import {
  predecessorsOf, successorsOf, wouldCreateCycle, isReady,
  hiddenByCollapse, collapsedCount
} from '../src/core/graph.js'

// Build: root → A → B → C, plus X → C (shared predecessor scenario via X → D)
function buildChain() {
  let goal = createGoal('G')
  const ids = {}
  for (const name of ['A', 'B', 'C', 'D', 'X']) {
    goal = addNode(goal, { title: name, type: 'task' })
    ids[name] = goal.nodes[goal.nodes.length - 1].id
  }
  goal = addEdge(goal, 'root', ids.A)
  goal = addEdge(goal, ids.A, ids.B)
  goal = addEdge(goal, ids.B, ids.C)
  goal = addEdge(goal, ids.X, ids.C)
  goal = addEdge(goal, ids.X, ids.D)
  return { goal, ids }
}

describe('predecessorsOf / successorsOf', () => {
  it('returns direct neighbors', () => {
    const { goal, ids } = buildChain()
    expect(predecessorsOf(goal, ids.C).map(n => n.id).sort())
      .toEqual([ids.B, ids.X].sort())
    expect(successorsOf(goal, ids.X).map(n => n.id).sort())
      .toEqual([ids.C, ids.D].sort())
    expect(predecessorsOf(goal, ids.A).map(n => n.id)).toEqual(['root'])
  })
})

describe('wouldCreateCycle', () => {
  it('detects cycles through transitive paths', () => {
    const { goal, ids } = buildChain()
    expect(wouldCreateCycle(goal, ids.C, ids.A)).toBe(true) // C→A closes A→B→C
    expect(wouldCreateCycle(goal, ids.C, 'root')).toBe(true)
    expect(wouldCreateCycle(goal, ids.A, ids.A)).toBe(true) // self
    expect(wouldCreateCycle(goal, ids.D, ids.C)).toBe(false)
    expect(wouldCreateCycle(goal, ids.A, ids.D)).toBe(false)
  })
})

describe('isReady', () => {
  it('todo node with all predecessors done is ready', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.B, { status: 'done' })
    goal = updateNode(goal, ids.X, { status: 'done' })
    expect(isReady(goal, ids.C)).toBe(true)
  })

  it('not ready when any predecessor is unfinished', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.B, { status: 'done' })
    expect(isReady(goal, ids.C)).toBe(false) // X still todo
  })

  it('node with no predecessors is ready, non-todo never ready', () => {
    let { goal, ids } = buildChain()
    expect(isReady(goal, ids.X)).toBe(true)
    goal = updateNode(goal, ids.X, { status: 'doing' })
    expect(isReady(goal, ids.X)).toBe(false)
    goal = updateNode(goal, ids.X, { status: 'done' })
    expect(isReady(goal, ids.X)).toBe(false)
  })
})

describe('hiddenByCollapse', () => {
  it('hides the upstream chain of a collapsed node', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.C, { collapsed: true })
    const hidden = hiddenByCollapse(goal)
    // B feeds only into C → hidden. A feeds only into B (hidden) → hidden.
    expect(hidden.has(ids.B)).toBe(true)
    expect(hidden.has(ids.A)).toBe(true)
    // X also feeds D (visible) → stays visible.
    expect(hidden.has(ids.X)).toBe(false)
    // root never hidden, C itself visible
    expect(hidden.has('root')).toBe(false)
    expect(hidden.has(ids.C)).toBe(false)
  })

  it('returns empty set when nothing is collapsed', () => {
    const { goal } = buildChain()
    expect(hiddenByCollapse(goal).size).toBe(0)
  })

  it('hides shared predecessor when all its successors are hidden or collapsed', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.C, { collapsed: true })
    goal = updateNode(goal, ids.D, { collapsed: true })
    const hidden = hiddenByCollapse(goal)
    expect(hidden.has(ids.X)).toBe(true) // both C and D collapsed
  })
})

describe('collapsedCount', () => {
  it('counts nodes hidden specifically by this collapse', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.C, { collapsed: true })
    expect(collapsedCount(goal, ids.C)).toBe(2) // A and B
  })
})
