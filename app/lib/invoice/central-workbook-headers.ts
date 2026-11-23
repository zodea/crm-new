import type { InvoiceImportSheet } from './excel'

/** 每列按工作表范围从零编号；值为安全解析所得原始表头显示文本。 */
export interface VerifiedInvoiceSheetHeaders {
  sheetName: string
  columns: readonly { index: number, rawHeader: string }[]
}

/** 缺失、不完整或与实际解析结果不一致时，不能当作无碰撞。 */
export function centralInvoiceHeaderStatus(evidence: readonly VerifiedInvoiceSheetHeaders[] | undefined, sheet: InvoiceImportSheet): 'valid' | 'missing' | 'collision' {
  if (!Array.isArray(evidence))
    return 'missing'
  const matches = evidence.filter(item => item?.sheetName === sheet.name)
  if (matches.length !== 1 || !Array.isArray(matches[0]?.columns) || matches[0].columns.length !== sheet.columns.length)
    return 'missing'
  const columns: VerifiedInvoiceSheetHeaders['columns'] = matches[0].columns
  if (columns.some((item, index) => !item || item.index !== index || typeof item.rawHeader !== 'string'))
    return 'missing'
  const explicit = new Set(columns.filter(item => item.rawHeader.trim()).map(item => item.rawHeader))
  const counts = new Map<string, number>()
  let collision = false
  for (const [index, item] of columns.entries()) {
    const base = item.rawHeader.trim() ? item.rawHeader : `__EMPTY_${index + 1}`
    if (!item.rawHeader.trim() && explicit.has(base))
      collision = true
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    if ((count === 0 ? base : `${base}_${count}`) !== sheet.columns[index])
      return 'missing'
  }
  return collision ? 'collision' : 'valid'
}
