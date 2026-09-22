/** 列表筛选兼容旧单值链接；空数组、空串和旧 all 哨兵均表示不限。 */
export function enumFilterValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item !== '' && item !== 'all'))]
}

/** 同字段选项取并集；调用方继续用各字段条件的交集。 */
export function matchesEnumFilter(value: string | null | undefined, selection: unknown): boolean {
  const selected = enumFilterValues(selection)
  return selected.length === 0 || (value != null && selected.includes(value))
}
