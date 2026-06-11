const STATUSES = ['todo', 'doing', 'done']
const TYPES = ['goal', 'project', 'task']

export function validateGoal(obj) {
  const errors = []
  if (typeof obj !== 'object' || obj === null) {
    return { valid: false, errors: ['数据不是对象'] }
  }
  if (typeof obj.title !== 'string') errors.push('title 必须是字符串')
  if (!Array.isArray(obj.nodes)) errors.push('nodes 必须是数组')
  if (!Array.isArray(obj.edges)) errors.push('edges 必须是数组')
  if (errors.length > 0) return { valid: false, errors }

  const ids = new Set()
  for (const node of obj.nodes) {
    if (typeof node !== 'object' || node === null) { errors.push('存在非法节点'); continue }
    if (typeof node.id !== 'string' || node.id === '') errors.push('节点缺少 id')
    if (ids.has(node.id)) errors.push(`节点 id 重复: ${node.id}`)
    ids.add(node.id)
    if (typeof node.title !== 'string') errors.push(`节点 ${node.id} 缺少 title`)
    if (!TYPES.includes(node.type)) errors.push(`节点 ${node.id} 的 type 非法`)
    if (!STATUSES.includes(node.status)) errors.push(`节点 ${node.id} 的 status 非法`)
  }
  if (!ids.has('root')) errors.push('缺少 root 根节点')

  const seen = new Set()
  for (const edge of obj.edges) {
    if (typeof edge !== 'object' || edge === null) { errors.push('存在非法边'); continue }
    if (!ids.has(edge.from)) errors.push(`边的起点不存在: ${edge.from}`)
    if (!ids.has(edge.to)) errors.push(`边的终点不存在: ${edge.to}`)
    const key = `${edge.from}→${edge.to}`
    if (seen.has(key)) errors.push(`边重复: ${key}`)
    seen.add(key)
  }
  return { valid: errors.length === 0, errors }
}

export function exportJSON(goal) {
  return JSON.stringify(goal, null, 2)
}

export function importJSON(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('JSON 解析失败: ' + error.message)
  }
  const { valid, errors } = validateGoal(parsed)
  if (!valid) throw new Error('数据校验失败: ' + errors.join('; '))
  return parsed
}
