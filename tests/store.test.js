import { describe, it, expect } from 'vitest'
import { createGoal } from '../src/core/model.js'
import {
  createStore, migrateStore, currentGoal, updateCurrentGoal,
  addGoal, removeGoal, switchGoal, renameCurrentGoal
} from '../src/core/store.js'

describe('createStore / currentGoal', () => {
  it('wraps a goal as the single entry', () => {
    const goal = createGoal('G1')
    const store = createStore(goal)
    expect(store.version).toBe(2)
    expect(store.goals).toHaveLength(1)
    expect(currentGoal(store)).toEqual(goal)
  })
})

describe('migrateStore', () => {
  it('migrates a legacy single-goal object (v1)', () => {
    const legacy = createGoal('老目标')
    const store = migrateStore(legacy)
    expect(store.version).toBe(2)
    expect(currentGoal(store).title).toBe('老目标')
  })

  it('passes through a valid v2 store', () => {
    const store = createStore(createGoal('G'))
    expect(migrateStore(store)).toEqual(store)
  })

  it('returns null for garbage', () => {
    expect(migrateStore(null)).toBeNull()
    expect(migrateStore({ foo: 1 })).toBeNull()
    expect(migrateStore({ version: 2, goals: [{ id: 'x', goal: { title: 1 } }] })).toBeNull()
  })
})

describe('updateCurrentGoal', () => {
  it('replaces only the current goal, immutably', () => {
    const store = addGoal(createStore(createGoal('A')), createGoal('B'))
    const next = updateCurrentGoal(store, createGoal('B2'))
    expect(currentGoal(next).title).toBe('B2')
    expect(next.goals[0].goal.title).toBe('A')
    expect(currentGoal(store).title).toBe('B') // immutability
  })
})

describe('addGoal / switchGoal / removeGoal', () => {
  it('addGoal appends and switches to the new goal', () => {
    const store = addGoal(createStore(createGoal('A')), createGoal('B'))
    expect(store.goals).toHaveLength(2)
    expect(currentGoal(store).title).toBe('B')
  })

  it('switchGoal changes current; unknown id throws', () => {
    const store = addGoal(createStore(createGoal('A')), createGoal('B'))
    const back = switchGoal(store, store.goals[0].id)
    expect(currentGoal(back).title).toBe('A')
    expect(() => switchGoal(store, 'nope')).toThrow()
  })

  it('removeGoal deletes and falls back to first remaining; last goal cannot be removed', () => {
    const store = addGoal(createStore(createGoal('A')), createGoal('B'))
    const next = removeGoal(store, store.currentId) // remove B (current)
    expect(next.goals).toHaveLength(1)
    expect(currentGoal(next).title).toBe('A')
    expect(() => removeGoal(next, next.currentId)).toThrow()
  })
})

describe('renameCurrentGoal', () => {
  it('renames goal title and root node title together', () => {
    const store = createStore(createGoal('旧'))
    const next = renameCurrentGoal(store, '新')
    expect(currentGoal(next).title).toBe('新')
    expect(currentGoal(next).nodes.find(n => n.id === 'root').title).toBe('新')
  })
})
