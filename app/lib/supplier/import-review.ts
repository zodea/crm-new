import type { SupplierImportDraft } from './command-contract'

/** 同一文件中出现相同名称或身份码时，要求先逐行处理，不能悄悄创建重复资料。 */
export function supplierImportFileDuplicates(entries: readonly { index: number, draft: SupplierImportDraft }[]): Map<number, number[]> {
  const groups = new Map<string, number[]>()
  for (const { index, draft } of entries) {
    for (const key of ['name', 'externalRef', 'uniqueCode', 'taxNo'] as const) {
      const value = typeof draft[key] === 'string' ? draft[key]!.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN') : ''
      if (!value)
        continue
      const group = groups.get(`${key}:${value}`) ?? []
      group.push(index)
      groups.set(`${key}:${value}`, group)
    }
  }
  const result = new Map<number, Set<number>>()
  for (const group of groups.values()) {
    if (group.length < 2)
      continue
    for (const index of group) {
      const others = result.get(index) ?? new Set<number>()
      for (const other of group) {
        if (other !== index)
          others.add(other)
      }
      result.set(index, others)
    }
  }
  return new Map([...result].map(([index, others]) => [index, [...others].sort((a, b) => a - b)]))
}
