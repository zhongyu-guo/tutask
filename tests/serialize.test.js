import { describe, it, expect } from 'vitest'
import { createGoal, addNode, addEdge } from '../src/core/model.js'
import { validateGoal, exportJSON, importJSON } from '../src/core/serialize.js'

function sampleGoal() {
  let goal = createGoal('G')
  goal = addNode(goal, { title: 'A', type: 'project' })
  const a = goal.nodes[1].id
  goal = addEdge(goal, 'root', a)
  return goal
}

describe('validateGoal', () => {
  it('accepts a well-formed goal', () => {
    const result = validateGoal(sampleGoal())
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it.each([
    ['not an object', null],
    ['missing title', { nodes: [], edges: [] }],
    ['nodes not array', { title: 'x', nodes: 'no', edges: [] }],
    ['missing root', { title: 'x', nodes: [{ id: 'a', title: 'a', type: 'task', status: 'todo' }], edges: [] }],
    ['bad status', { title: 'x', nodes: [{ id: 'root', title: 'x', type: 'goal', status: 'nope' }], edges: [] }],
    ['bad type', { title: 'x', nodes: [{ id: 'root', title: 'x', type: 'wat', status: 'todo' }], edges: [] }],
    ['edge to unknown node', { title: 'x', nodes: [{ id: 'root', title: 'x', type: 'goal', status: 'todo' }], edges: [{ from: 'root', to: 'ghost' }] }],
    ['duplicate edge', {
      title: 'x',
      nodes: [
        { id: 'root', title: 'x', type: 'goal', status: 'todo' },
        { id: 'a', title: 'a', type: 'task', status: 'todo' }
      ],
      edges: [{ from: 'root', to: 'a' }, { from: 'root', to: 'a' }]
    }],
    ['duplicate node id', {
      title: 'x',
      nodes: [
        { id: 'root', title: 'x', type: 'goal', status: 'todo' },
        { id: 'a', title: 'a', type: 'task', status: 'todo' },
        { id: 'a', title: 'b', type: 'task', status: 'todo' }
      ],
      edges: []
    }]
  ])('rejects %s', (_name, bad) => {
    const result = validateGoal(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('exportJSON / importJSON', () => {
  it('round-trips a goal', () => {
    const goal = sampleGoal()
    const restored = importJSON(exportJSON(goal))
    expect(restored).toEqual(goal)
  })

  it('throws a descriptive error on invalid JSON text', () => {
    expect(() => importJSON('{oops')).toThrow(/JSON/)
  })

  it('throws on structurally invalid data', () => {
    expect(() => importJSON('{"title":1}')).toThrow()
  })
})
