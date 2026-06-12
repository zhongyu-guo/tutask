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
  // prerequisites of a node are its sub-steps: the nodes it points to (successors)
  it('todo node with all prerequisite sub-steps done is ready', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.C, { status: 'done' })
    goal = updateNode(goal, ids.D, { status: 'done' })
    expect(isReady(goal, ids.X)).toBe(true) // X's sub-steps C and D both done
  })

  it('not ready when any prerequisite sub-step is unfinished', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.C, { status: 'done' })
    expect(isReady(goal, ids.X)).toBe(false) // D still todo
  })

  it('leaf node (no sub-steps) is ready, non-todo never ready', () => {
    let { goal, ids } = buildChain()
    expect(isReady(goal, ids.C)).toBe(true) // leaf
    goal = updateNode(goal, ids.C, { status: 'doing' })
    expect(isReady(goal, ids.C)).toBe(false)
    goal = updateNode(goal, ids.C, { status: 'done' })
    expect(isReady(goal, ids.C)).toBe(false)
  })
})

describe('hiddenByCollapse', () => {
  // collapsing a node folds its prerequisite subtree (the sub-steps it points to)
  it('hides the sub-step chain of a collapsed node', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.A, { collapsed: true })
    const hidden = hiddenByCollapse(goal)
    // B is reachable only through A → hidden.
    expect(hidden.has(ids.B)).toBe(true)
    // C is also fed by X (visible) → stays visible. D untouched.
    expect(hidden.has(ids.C)).toBe(false)
    expect(hidden.has(ids.D)).toBe(false)
    expect(hidden.has(ids.X)).toBe(false)
    // root never hidden, A itself visible
    expect(hidden.has('root')).toBe(false)
    expect(hidden.has(ids.A)).toBe(false)
  })

  it('returns empty set when nothing is collapsed', () => {
    const { goal } = buildChain()
    expect(hiddenByCollapse(goal).size).toBe(0)
  })

  it('hides shared sub-step when all paths into it are collapsed or hidden', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.A, { collapsed: true })
    goal = updateNode(goal, ids.X, { collapsed: true })
    const hidden = hiddenByCollapse(goal)
    expect(hidden.has(ids.B)).toBe(true)
    expect(hidden.has(ids.C)).toBe(true) // B hidden + X collapsed
    expect(hidden.has(ids.D)).toBe(true)
  })

  it('lets an ancestor collapse hide descendants that are collapsed themselves', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.A, { collapsed: true })
    goal = updateNode(goal, ids.B, { collapsed: true })

    let hidden = hiddenByCollapse(goal)
    expect(hidden.has(ids.B)).toBe(true)
    expect(hidden.has(ids.C)).toBe(false) // C still has visible X as another parent

    goal = updateNode(goal, ids.A, { collapsed: false })
    hidden = hiddenByCollapse(goal)
    expect(hidden.has(ids.B)).toBe(false)
    expect(hidden.has(ids.C)).toBe(false)
  })
})

describe('collapsedCount', () => {
  it('counts all descendant sub-step nodes', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.A, { collapsed: true })
    expect(collapsedCount(goal, ids.A)).toBe(2) // B and C
    goal = updateNode(goal, ids.X, { collapsed: true })
    expect(collapsedCount(goal, ids.X)).toBe(2) // C and D
  })

  it('does not depend on whether descendants are currently hidden', () => {
    let { goal, ids } = buildChain()
    goal = updateNode(goal, ids.B, { collapsed: true })
    expect(collapsedCount(goal, ids.B)).toBe(1) // C

    goal = updateNode(goal, ids.A, { collapsed: true })
    expect(collapsedCount(goal, ids.A)).toBe(2) // B and C
  })
})
