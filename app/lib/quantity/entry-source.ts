export type QuantityEntrySource = 'contract' | 'provisional' | 'field'

export interface QuantityEntrySourceLine {
  recognizedContractQty: number | null
  contractQty: number | null
  provisionalQty: number | null
  fieldFormula: string
}

export const QUANTITY_ENTRY_SOURCE_OPTIONS: readonly {
  value: QuantityEntrySource
  label: string
}[] = [
  { value: 'contract', label: '合同量' },
  { value: 'provisional', label: '暂估量' },
  { value: 'field', label: '现场复核' },
]

/**
 * 录入来源只控制当前显示的编辑器，不改变三量分别存储的领域事实。
 * 新建手工明细默认从暂估量开始；已有合同量时优先展示合同约定，
 * 让施工前阅读态与后续量差/收支对照使用同一口径。
 */
export function defaultQuantityEntrySource(line: QuantityEntrySourceLine): QuantityEntrySource {
  if (line.recognizedContractQty != null || line.contractQty != null)
    return 'contract'
  if (line.fieldFormula.trim())
    return 'field'
  if (line.provisionalQty != null)
    return 'provisional'
  return 'provisional'
}
