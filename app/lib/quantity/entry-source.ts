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
 * 新建手工明细默认从暂估量开始；BOQ 或已有量按已有事实就近定位。
 */
export function defaultQuantityEntrySource(line: QuantityEntrySourceLine): QuantityEntrySource {
  if (line.fieldFormula.trim())
    return 'field'
  if (line.provisionalQty != null)
    return 'provisional'
  if (line.recognizedContractQty != null || line.contractQty != null)
    return 'contract'
  return 'provisional'
}
