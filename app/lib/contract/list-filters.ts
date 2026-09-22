/** 旧单值链接保持兼容；多选通过一个 JSON 数组参数穿过 HTTP 与详情返回链。 */
export type ContractListFilter = string | string[] | null

export function parseContractListFilter(
  input: unknown,
  invalid: () => Error = () => new Error('合同筛选参数无效'),
): ContractListFilter {
  if (input == null || input === '')
    return null
  let value = input
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text)
      return null
    value = text
    if (text.startsWith('[')) {
      try {
        value = JSON.parse(text)
      }
      catch {
        throw invalid()
      }
    }
  }
  const values = Array.isArray(value) ? value : [value]
  if (values.length > 20 || values.some(item => typeof item !== 'string'
    || !item.trim() || item.length > 80
    || [...item].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127))) {
    throw invalid()
  }
  const normalized = [...new Set(values.map(item => (item as string).trim()))]
  return Array.isArray(value) ? normalized.length ? normalized : null : normalized[0] ?? null
}

export function contractListFilterValues(filter: ContractListFilter): string[] {
  return Array.isArray(filter) ? filter : filter ? [filter] : []
}

export function serializeContractListFilter(filter: ContractListFilter): string {
  return Array.isArray(filter) ? filter.length ? JSON.stringify(filter) : '' : filter ?? ''
}

export function matchesContractListFilter(value: string, filter: ContractListFilter): boolean {
  const selected = contractListFilterValues(filter)
  return selected.length === 0 || selected.includes(value)
}
