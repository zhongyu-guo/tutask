export const ROOT_ID = 'root'
export const EDGE_DIRECTION = 'child-to-parent'
export const STORE_VERSION = 2

export const STATUSES = ['todo', 'doing', 'done']
export const CHAIN_STATUSES = ['active', 'paused']
export const NODE_TYPES = ['goal', 'project', 'task']

export const NODE_DEFAULTS = {
  status: 'todo',
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
}

const NODE_DEFAULT_KEYS = Object.keys(NODE_DEFAULTS)

export function createNodeRecord({ id, type, title }) {
  return {
    id,
    type,
    title,
    ...NODE_DEFAULTS
  }
}

export function createRootNode(title) {
  return createNodeRecord({ id: ROOT_ID, type: 'goal', title })
}

export function normalizeNode(node) {
  if (typeof node !== 'object' || node === null) return node
  const normalized = { ...NODE_DEFAULTS, ...node }
  for (const key of NODE_DEFAULT_KEYS) {
    if (normalized[key] === undefined) normalized[key] = NODE_DEFAULTS[key]
  }
  return normalized
}

export function normalizeEdge(edge) {
  if (typeof edge !== 'object' || edge === null) return edge
  return { ...edge }
}

export function normalizeGoal(goal) {
  if (typeof goal !== 'object' || goal === null) return goal
  return {
    ...goal,
    edgeDirection: EDGE_DIRECTION,
    nodes: Array.isArray(goal.nodes) ? goal.nodes.map(normalizeNode) : goal.nodes,
    edges: Array.isArray(goal.edges) ? goal.edges.map(normalizeEdge) : goal.edges
  }
}

export function normalizeStore(store) {
  if (typeof store !== 'object' || store === null) return store
  return {
    ...store,
    version: STORE_VERSION,
    goals: Array.isArray(store.goals)
      ? store.goals.map(entry => ({
        ...entry,
        goal: normalizeGoal(entry.goal)
      }))
      : store.goals
  }
}
