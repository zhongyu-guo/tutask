import { describe, it, expect } from 'vitest'
import { addEdge, addNode, createGoal } from '../src/core/model.js'
import {
  createFloatingCommand, createParallelCommand, createSuccessorCommand,
  cycleNodeStatusCommand, deleteNodesCommand, setNodeTitleCommand
} from '../src/ui/commands.js'

describe('task graph commands', () => {
  it('creates a successor and links it to the selected node', () => {
    const goal = createGoal('G')
    const result = createSuccessorCommand(goal, 'root')

    expect(result.nodeId).toBeTruthy()
    expect(result.goal.nodes).toHaveLength(2)
    expect(result.goal.nodes[1]).toMatchObject({ type: 'project', title: '' })
    expect(result.goal.edges).toEqual([{ from: result.nodeId, to: 'root' }])
    expect(goal.nodes).toHaveLength(1)
  })

  it('creates a parallel node immediately after the selected sibling', () => {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'A', type: 'project' })
    const a = goal.nodes[1].id
    goal = addNode(goal, { title: 'B', type: 'project' })
    const b = goal.nodes[2].id
    goal = addEdge(goal, a, 'root')
    goal = addEdge(goal, b, 'root')

    const result = createParallelCommand(goal, a)
    const siblings = result.goal.edges.filter(edge => edge.to === 'root').map(edge => edge.from)

    expect(siblings).toEqual([a, result.nodeId, b])
  })

  it('creates a manually positioned floating task', () => {
    const result = createFloatingCommand(createGoal('G'), { x: 12, y: 34 })

    expect(result.goal.nodes[1]).toMatchObject({ type: 'task', x: 12, y: 34 })
    expect(result.goal.edges).toEqual([])
  })

  it('deletes selected nodes but never deletes root', () => {
    let goal = createGoal('G')
    goal = addNode(goal, { title: 'A', type: 'task' })
    const a = goal.nodes[1].id
    goal = addEdge(goal, a, 'root')

    const next = deleteNodesCommand(goal, ['root', a])
    expect(next.nodes.map(node => node.id)).toEqual(['root'])
    expect(next.edges).toEqual([])
  })

  it('keeps the goal title and root title in sync', () => {
    const next = setNodeTitleCommand(createGoal('G'), 'root', 'New')

    expect(next.title).toBe('New')
    expect(next.nodes[0].title).toBe('New')
  })

  it('cycles non-root node status only', () => {
    const goal = createSuccessorCommand(createGoal('G'), 'root').goal
    const nodeId = goal.nodes[1].id

    expect(cycleNodeStatusCommand(goal, nodeId).nodes[1].status).toBe('doing')
    expect(cycleNodeStatusCommand(goal, 'root')).toBe(goal)
  })
})
