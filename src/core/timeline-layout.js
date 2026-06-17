// Pure time-axis layout: place tasks into columns by their deadline bucket.
// Decoupled from the DAG layout — reads only id/title/deadline/status, computes
// positions + ruler axis metadata, and never mutates the goal. See
// docs/plans/2026-06-17-ddl-timeline-ruler-design.md.

const DAY_MS = 86400000
const STATUS_RANK = { doing: 0, todo: 1, done: 2 }

const DEFAULTS = {
  colWidth: { day: 220, week: 240, month: 260 },
  rowHeight: 96, // NODE_H (64) + vertical gap
  headerHeight: 48,
  laneGap: 60 // gap between the last time column and the no-DDL lane
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date) {
  const d = startOfDay(date)
  const offset = (d.getDay() + 6) % 7 // Monday = 0
  d.setDate(d.getDate() - offset)
  return d
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function bucketAnchor(date, scale) {
  if (scale === 'week') return startOfWeek(date)
  if (scale === 'month') return startOfMonth(date)
  return startOfDay(date)
}

export function bucketKey(date, scale) {
  const a = bucketAnchor(date, scale)
  if (scale === 'month') return `${a.getFullYear()}-${a.getMonth() + 1}`
  return `${a.getFullYear()}-${a.getMonth() + 1}-${a.getDate()}`
}

function nextAnchor(anchor, scale) {
  if (scale === 'week') return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7)
  if (scale === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1)
}

export function formatDeadline(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function countdownLabel(deadline, today) {
  if (!deadline) return ''
  const days = Math.round((startOfDay(parseDate(deadline)) - startOfDay(today)) / DAY_MS)
  if (days > 0) return `距今 ${days} 天`
  if (days === 0) return '今天截止'
  return `逾期 ${-days} 天`
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function columnLabel(anchor, scale) {
  const m = anchor.getMonth() + 1
  const d = anchor.getDate()
  if (scale === 'month') return { primary: `${m}月`, secondary: String(anchor.getFullYear()) }
  if (scale === 'week') {
    const end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 6)
    return { primary: `${m}/${d}`, secondary: `~${end.getMonth() + 1}/${end.getDate()}` }
  }
  return { primary: `${m}/${d}`, secondary: WEEKDAYS[(anchor.getDay() + 6) % 7] }
}

// group dated nodes by bucket key; returns Map<key, { anchor, ids: [] }>
function groupByBucket(datedNodes, scale) {
  const groups = new Map()
  for (const node of datedNodes) {
    const date = parseDate(node.deadline)
    const key = bucketKey(date, scale)
    if (!groups.has(key)) groups.set(key, { anchor: bucketAnchor(date, scale), ids: [] })
    groups.get(key).ids.push(node.id)
  }
  return groups
}

function continuousAnchors(groups, todayAnchor, scale) {
  const anchors = [...[...groups.values()].map(g => g.anchor), todayAnchor]
  let min = anchors[0]
  let max = anchors[0]
  for (const a of anchors) {
    if (a < min) min = a
    if (a > max) max = a
  }
  const out = []
  for (let cur = min; cur <= max; cur = nextAnchor(cur, scale)) out.push(cur)
  return out
}

function compactAnchors(groups, todayAnchor, todayKey) {
  const byKey = new Map([...groups].map(([key, g]) => [key, g.anchor]))
  if (!byKey.has(todayKey)) byKey.set(todayKey, todayAnchor)
  return [...byKey.values()].sort((a, b) => a - b)
}

function stackColumn(ids, nodeById, x, headerHeight, rowHeight, positions) {
  const ordered = [...ids].sort((a, b) => {
    const na = nodeById.get(a)
    const nb = nodeById.get(b)
    const rank = (STATUS_RANK[na.status] ?? 1) - (STATUS_RANK[nb.status] ?? 1)
    return rank || (na.title || '').localeCompare(nb.title || '')
  })
  ordered.forEach((id, row) => {
    positions.set(id, { x, y: headerHeight + row * rowHeight })
  })
  return ordered.length
}

export function timelineLayout(goal, opts = {}) {
  const {
    scale = 'day',
    range = 'continuous',
    today = new Date(),
    rowHeight = DEFAULTS.rowHeight,
    headerHeight = DEFAULTS.headerHeight,
    laneGap = DEFAULTS.laneGap
  } = opts
  const width = (opts.colWidth ?? DEFAULTS.colWidth)[scale] ?? DEFAULTS.colWidth[scale]

  const nodeById = new Map(goal.nodes.map(n => [n.id, n]))
  const dated = goal.nodes.filter(n => n.deadline)
  const undatedIds = goal.nodes.filter(n => !n.deadline).map(n => n.id)

  const groups = groupByBucket(dated, scale)
  const todayAnchor = bucketAnchor(today, scale)
  const todayKey = bucketKey(today, scale)
  const anchors = range === 'compact'
    ? compactAnchors(groups, todayAnchor, todayKey)
    : continuousAnchors(groups, todayAnchor, scale)

  const positions = new Map()
  let maxRows = 1
  const columns = anchors.map((anchor, i) => {
    const key = bucketKey(anchor, scale)
    const x = i * width
    const group = groups.get(key)
    const rows = group ? stackColumn(group.ids, nodeById, x, headerHeight, rowHeight, positions) : 0
    if (rows > maxRows) maxRows = rows
    return {
      key,
      anchor,
      x,
      width,
      label: columnLabel(anchor, scale),
      isToday: key === todayKey,
      isEmpty: rows === 0
    }
  })

  const noDateX = columns.length * width + laneGap
  const noDateRows = stackColumn(undatedIds, nodeById, noDateX, headerHeight, rowHeight, positions)
  if (noDateRows > maxRows) maxRows = noDateRows

  return {
    positions,
    axis: {
      columns,
      todayKey,
      noDate: { x: noDateX, width, ids: undatedIds },
      contentHeight: headerHeight + maxRows * rowHeight
    }
  }
}

// snap an x coordinate to the time column whose band contains it (clamped to ends)
export function columnForX(x, axis) {
  const { columns } = axis
  if (columns.length === 0) return null
  for (const col of columns) {
    if (x >= col.x && x < col.x + col.width) return col
  }
  return x < columns[0].x ? columns[0] : columns[columns.length - 1]
}
