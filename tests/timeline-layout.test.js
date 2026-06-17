import { describe, it, expect } from 'vitest'
import { createGoal, addNode, updateNode } from '../src/core/model.js'
import {
  bucketKey, bucketAnchor, countdownLabel,
  formatDeadline, timelineLayout, columnForX
} from '../src/core/timeline-layout.js'

const TODAY = new Date(2026, 5, 17) // 2026-06-17 (Wed)

// Build a goal with named tasks; deadlines is { name: 'YYYY-MM-DD' | null }
function buildGoal(deadlines) {
  let goal = createGoal('G')
  const ids = {}
  for (const name of Object.keys(deadlines)) {
    goal = addNode(goal, { title: name, type: 'task' })
    const id = goal.nodes[goal.nodes.length - 1].id
    ids[name] = id
    if (deadlines[name]) goal = updateNode(goal, id, { deadline: deadlines[name] })
  }
  return { goal, ids }
}

describe('bucketKey / bucketAnchor', () => {
  it('day scale keys by the exact day', () => {
    const d = new Date(2026, 5, 17)
    expect(bucketKey(d, 'day')).toBe('2026-6-17')
    expect(bucketAnchor(d, 'day')).toEqual(new Date(2026, 5, 17))
  })

  it('week scale anchors to ISO Monday', () => {
    // 2026-06-17 is a Wednesday → week of Monday 2026-06-15
    const d = new Date(2026, 5, 17)
    expect(bucketAnchor(d, 'week')).toEqual(new Date(2026, 5, 15))
    expect(bucketKey(d, 'week')).toBe('2026-6-15')
    // Sunday belongs to the previous Monday's week
    expect(bucketAnchor(new Date(2026, 5, 21), 'week')).toEqual(new Date(2026, 5, 15))
  })

  it('month scale anchors to the first of the month', () => {
    const d = new Date(2026, 5, 17)
    expect(bucketAnchor(d, 'month')).toEqual(new Date(2026, 5, 1))
    expect(bucketKey(d, 'month')).toBe('2026-6')
  })
})

describe('countdownLabel', () => {
  it('labels future days', () => {
    expect(countdownLabel('2026-06-20', TODAY)).toBe('距今 3 天')
  })
  it('labels today', () => {
    expect(countdownLabel('2026-06-17', TODAY)).toBe('今天截止')
  })
  it('labels overdue days', () => {
    expect(countdownLabel('2026-06-15', TODAY)).toBe('逾期 2 天')
  })
  it('returns empty for no deadline', () => {
    expect(countdownLabel(null, TODAY)).toBe('')
  })
})

describe('formatDeadline', () => {
  it('zero-pads to YYYY-MM-DD', () => {
    expect(formatDeadline(new Date(2026, 5, 1))).toBe('2026-06-01')
    expect(formatDeadline(new Date(2026, 11, 25))).toBe('2026-12-25')
  })
})

describe('timelineLayout — continuous range', () => {
  it('fills every day column between earliest and latest deadline (incl today)', () => {
    const { goal } = buildGoal({ A: '2026-06-16', B: '2026-06-20' })
    const { axis } = timelineLayout(goal, { scale: 'day', range: 'continuous', today: TODAY })
    expect(axis.columns.map(c => c.key)).toEqual([
      '2026-6-16', '2026-6-17', '2026-6-18', '2026-6-19', '2026-6-20'
    ])
    // 17/18/19 have no tasks
    expect(axis.columns.find(c => c.key === '2026-6-18').isEmpty).toBe(true)
    expect(axis.columns.find(c => c.key === '2026-6-16').isEmpty).toBe(false)
  })

  it('flags the today column', () => {
    const { goal } = buildGoal({ A: '2026-06-16', B: '2026-06-20' })
    const { axis } = timelineLayout(goal, { scale: 'day', range: 'continuous', today: TODAY })
    expect(axis.todayKey).toBe('2026-6-17')
    expect(axis.columns.find(c => c.isToday).key).toBe('2026-6-17')
  })

  it('assigns x by column index times the day column width', () => {
    const { goal } = buildGoal({ A: '2026-06-16', B: '2026-06-18' })
    const { axis } = timelineLayout(goal, {
      scale: 'day', range: 'continuous', today: TODAY, colWidth: { day: 200 }
    })
    expect(axis.columns.map(c => c.x)).toEqual([0, 200, 400])
  })
})

describe('timelineLayout — compact range', () => {
  it('keeps only buckets with tasks plus the today column', () => {
    const { goal } = buildGoal({ A: '2026-06-16', B: '2026-06-20' })
    const { axis } = timelineLayout(goal, { scale: 'day', range: 'compact', today: TODAY })
    expect(axis.columns.map(c => c.key)).toEqual(['2026-6-16', '2026-6-17', '2026-6-20'])
  })
})

describe('timelineLayout — positions', () => {
  it('stacks same-bucket tasks by status priority (doing, todo, done)', () => {
    const { goal, ids } = buildGoal({ A: '2026-06-20', B: '2026-06-20', C: '2026-06-20' })
    const g = updateNode(updateNode(goal, ids.A, { status: 'done' }), ids.B, { status: 'doing' })
    const { positions } = timelineLayout(g, {
      scale: 'day', range: 'compact', today: TODAY, rowHeight: 100, headerHeight: 40
    })
    // same column → same x
    expect(positions.get(ids.A).x).toBe(positions.get(ids.B).x)
    // doing (B) on top, then todo (C), then done (A)
    expect(positions.get(ids.B).y).toBeLessThan(positions.get(ids.C).y)
    expect(positions.get(ids.C).y).toBeLessThan(positions.get(ids.A).y)
  })

  it('places undated nodes (incl root) in the no-DDL lane to the right', () => {
    const { goal, ids } = buildGoal({ A: '2026-06-20', Floating: null })
    const { positions, axis } = timelineLayout(goal, {
      scale: 'day', range: 'compact', today: TODAY
    })
    expect(axis.noDate.ids).toContain('root')
    expect(axis.noDate.ids).toContain(ids.Floating)
    expect(axis.noDate.ids).not.toContain(ids.A)
    // lane sits to the right of the last time column
    const lastCol = axis.columns[axis.columns.length - 1]
    expect(axis.noDate.x).toBeGreaterThan(lastCol.x)
    expect(positions.get(ids.Floating).x).toBe(axis.noDate.x)
  })

  it('handles a goal with no dated tasks: one today column', () => {
    const { goal } = buildGoal({ A: null })
    const { axis } = timelineLayout(goal, { scale: 'day', range: 'continuous', today: TODAY })
    expect(axis.columns.map(c => c.key)).toEqual(['2026-6-17'])
    expect(axis.columns[0].isToday).toBe(true)
  })
})

describe('columnForX', () => {
  it('snaps an x coordinate to the column that contains it', () => {
    const { goal } = buildGoal({ A: '2026-06-16', B: '2026-06-18' })
    const { axis } = timelineLayout(goal, {
      scale: 'day', range: 'continuous', today: TODAY, colWidth: { day: 200 }
    })
    // columns at x = 0,200,400 (keys 16,17,18)
    expect(columnForX(250, axis).key).toBe('2026-6-17')
    expect(columnForX(10, axis).key).toBe('2026-6-16')
    expect(columnForX(420, axis).key).toBe('2026-6-18')
  })

  it('clamps out-of-range x to the nearest edge column', () => {
    const { goal } = buildGoal({ A: '2026-06-16', B: '2026-06-18' })
    const { axis } = timelineLayout(goal, {
      scale: 'day', range: 'continuous', today: TODAY, colWidth: { day: 200 }
    })
    expect(columnForX(-100, axis).key).toBe('2026-6-16')
    expect(columnForX(9999, axis).key).toBe('2026-6-18')
  })
})
