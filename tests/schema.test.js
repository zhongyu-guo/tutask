import { describe, it, expect } from 'vitest'
import { createGoal } from '../src/core/model.js'
import { importJSON, validateGoal } from '../src/core/serialize.js'
import { migrateStore } from '../src/core/store.js'
import { normalizeGoal } from '../src/core/schema.js'

describe('normalizeGoal', () => {
  it('fills optional node defaults from the central schema', () => {
    const normalized = normalizeGoal({
      title: 'G',
      nodes: [{ id: 'root', type: 'goal', title: 'G', status: 'todo' }],
      edges: []
    })

    expect(normalized).toMatchObject({
      edgeDirection: 'child-to-parent',
      nodes: [{
        id: 'root',
        chainStatus: 'active',
        description: '',
        estimatedHours: null,
        deadline: null,
        x: null,
        y: null,
        collapsed: false,
        detailOpen: false,
        fill: null,
        stroke: null
      }]
    })
  })

  it('preserves legacy edge direction hints for later layout normalization', () => {
    const normalized = normalizeGoal({
      title: 'G',
      nodes: [
        { id: 'root', type: 'goal', title: 'G', status: 'todo' },
        { id: 'a', type: 'task', title: 'A', status: 'todo' }
      ],
      edges: [{ from: 'root', to: 'a', visualDirection: 'reverse' }]
    })

    expect(normalized.edges[0].visualDirection).toBe('reverse')
  })
})

describe('schema-backed validation', () => {
  it('imports legacy goal JSON and returns the normalized current shape', () => {
    const imported = importJSON(JSON.stringify({
      title: 'G',
      nodes: [{ id: 'root', type: 'goal', title: 'G', status: 'todo' }],
      edges: []
    }))

    expect(imported.nodes[0].chainStatus).toBe('active')
    expect(imported.nodes[0].fill).toBeNull()
  })

  it('rejects invalid optional field shapes after normalization', () => {
    const result = validateGoal({
      title: 'G',
      nodes: [{
        id: 'root',
        type: 'goal',
        title: 'G',
        status: 'todo',
        estimatedHours: 'soon'
      }],
      edges: []
    })

    expect(result.valid).toBe(false)
    expect(result.errors.join(';')).toContain('estimatedHours')
  })

  it('rejects a root node with a non-goal type', () => {
    const result = validateGoal({
      title: 'G',
      nodes: [{ id: 'root', type: 'task', title: 'G', status: 'todo' }],
      edges: []
    })

    expect(result.valid).toBe(false)
    expect(result.errors.join(';')).toContain('root')
  })
})

describe('migrateStore', () => {
  it('normalizes v2 stores instead of passing raw data through', () => {
    const raw = {
      version: 2,
      currentId: 'g',
      goals: [{
        id: 'g',
        goal: {
          title: 'G',
          nodes: [{ id: 'root', type: 'goal', title: 'G', status: 'todo' }],
          edges: []
        }
      }]
    }

    const migrated = migrateStore(raw)
    expect(migrated.goals[0].goal.nodes[0].chainStatus).toBe('active')
  })

  it('rejects duplicate goal ids', () => {
    const goal = createGoal('G')
    const migrated = migrateStore({
      version: 2,
      currentId: 'dup',
      goals: [
        { id: 'dup', goal },
        { id: 'dup', goal }
      ]
    })

    expect(migrated).toBeNull()
  })
})
