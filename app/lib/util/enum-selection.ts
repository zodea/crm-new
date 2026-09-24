/** 单值旧链接、JSON 数组和重复查询参数统一为精确匹配集合；空数组表示不限。 */
export function normalizeEnumSelection(value: unknown): string[] {
  if (value === undefined || value === null || value === '')
    return []
  const input: unknown = typeof value === 'string' && value.trim().startsWith('[') ? JSON.parse(value) : value
  const values = typeof input === 'string' ? [input] : input
  if (!Array.isArray(values) || !values.every(item => typeof item === 'string'))
    throw new TypeError('invalid enum selection')
  return [...new Set(values.map(item => item.trim()).filter(item => item && item !== 'all'))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

export function serializeEnumSelection(value: unknown): string {
  const values = normalizeEnumSelection(value)
  return values.length > 1 ? JSON.stringify(values) : values[0] ?? ''
}

/** 仅供页面恢复不可信 URL；HTTP 边界应使用严格归一化并转成领域 invalid-query。 */
export function enumSelectionFromQuery(value: unknown): string[] {
  try {
    return normalizeEnumSelection(value)
  }
  catch {
    return []
  }
}
