import { describe, it, expect } from 'vitest'
import {
  createGoal, addNode, updateNode, removeNode, addEdge, removeEdge, updateEdge
} from '../src/core/model.js'

describe('createGoal', () => {
  it('creates a goal with a root node', () => {
    const goal = createGoal('我的目标')
    expect(goal.title).toBe('我的目标')
    expect(goal.nodes).toHaveLength(1)
    expect(goal.nodes[0]).toMatchObject({ id: 'root', type: 'goal', title: '我的目标' })
    expect(goal.edges).toEqual([])
  })
})

describe('addNode', () => {
  it('adds a node with generated id and defaults', () => {
    const goal = createGoal('G')
    const next = addNode(goal, { title: 'A', type: 'project' })
    expect(next.nodes).toHaveLength(2)
    const node = next.nodes[1]
    expect(node.id).toBeTruthy()
    expect(node).toMatchObject({
      title: 'A', type: 'project', status: 'todo', chainStatus: 'active', description: '',
      estimatedHours: null, deadline: null, x: null, y: null,
      collapsed: false, detailOpen: false
    })
  })

  it('does not mutate the original goal', () => {
    const goal = createGoal('G')
    addNode(goal, { title: 'A', type: 'task' })
    expect(goal.nodes).toHaveLength(1)
  })

  it('generates unique ids', () => {
    let goal = createGoal('G')
    for (let i = 0; i < 50; i++) goal = addNode(goal, { title: 't' + i, type: 'task' })
    const ids = new Set(goal.nodes.map(n => n.id))
    expect(ids.size).toBe(51)
  })
})

describe('updateNode', () => {
  it('updates only the target node', () => {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'A', type: 'task' })
    const id = goal.nodes[1].id
    const next = updateNode(goal, id, { title: 'B', status: 'doing' })
    expect(next.nodes[1].title).toBe('B')
    expect(next.nodes[1].status).toBe('doing')
    expect(next.nodes[0].title).toBe('G')
    expect(goal.nodes[1].title).toBe('A') // immutability
  })

  it('throws for unknown id', () => {
    const goal = createGoal('G')
    expect(() => updateNode(goal, 'nope', { title: 'x' })).toThrow()
  })
})

describe('addEdge / removeEdge', () => {
  function twoNodes() {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'A', type: 'task' })
    goal = addNode(goal, { title: 'B', type: 'task' })
    return { goal, a: goal.nodes[1].id, b: goal.nodes[2].id }
  }

  it('adds an edge', () => {
    const { goal, a, b } = twoNodes()
    const next = addEdge(goal, a, b)
    expect(next.edges).toEqual([{ from: a, to: b }])
    expect(goal.edges).toEqual([]) // immutability
  })

  it('rejects duplicate edges', () => {
    const { goal, a, b } = twoNodes()
    const next = addEdge(goal, a, b)
    expect(() => addEdge(next, a, b)).toThrow()
  })

  it('rejects self-loops', () => {
    const { goal, a } = twoNodes()
    expect(() => addEdge(goal, a, a)).toThrow()
  })

  it('rejects edges with unknown endpoints', () => {
    const { goal, a } = twoNodes()
    expect(() => addEdge(goal, a, 'nope')).toThrow()
    expect(() => addEdge(goal, 'nope', a)).toThrow()
  })

  it('removes an edge', () => {
    const { goal, a, b } = twoNodes()
    const withEdge = addEdge(goal, a, b)
    const next = removeEdge(withEdge, a, b)
    expect(next.edges).toEqual([])
    expect(withEdge.edges).toHaveLength(1) // immutability
  })
})

describe('removeNode', () => {
  it('removes the node and all connected edges', () => {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'A', type: 'task' })
    goal = addNode(goal, { title: 'B', type: 'task' })
    const [a, b] = [goal.nodes[1].id, goal.nodes[2].id]
    goal = addEdge(goal, 'root', a)
    goal = addEdge(goal, a, b)
    const next = removeNode(goal, a)
    expect(next.nodes.map(n => n.id)).toEqual(['root', b])
    expect(next.edges).toEqual([])
    expect(goal.nodes).toHaveLength(3) // immutability
  })

  it('refuses to remove root', () => {
    const goal = createGoal('G')
    expect(() => removeNode(goal, 'root')).toThrow()
  })
})

describe('updateEdge', () => {
  function edged() {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'A', type: 'task' })
    const a = goal.nodes[1].id
    goal = addEdge(goal, 'root', a)
    return { goal, a }
  }

  it('patches an edge immutably and keeps endpoints', () => {
    const { goal, a } = edged()
    const next = updateEdge(goal, 'root', a, { color: '#ff0000', from: 'hack' })
    expect(next.edges[0]).toEqual({ from: 'root', to: a, color: '#ff0000' })
    expect(goal.edges[0].color).toBeUndefined() // immutability
  })

  it('clears a color with null', () => {
    const { goal, a } = edged()
    const colored = updateEdge(goal, 'root', a, { color: '#ff0000' })
    expect(updateEdge(colored, 'root', a, { color: null }).edges[0].color).toBeNull()
  })

  it('throws for a missing edge', () => {
    const { goal } = edged()
    expect(() => updateEdge(goal, 'root', 'nope', { color: '#fff' })).toThrow()
  })
})

describe('node color defaults', () => {
  it('new nodes have null fill and stroke', () => {
    const goal = addNode(createGoal('G'), { title: 'A', type: 'task' })
    expect(goal.nodes[0]).toMatchObject({ fill: null, stroke: null })
    expect(goal.nodes[1]).toMatchObject({ fill: null, stroke: null })
  })
})
