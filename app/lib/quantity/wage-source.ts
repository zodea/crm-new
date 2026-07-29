export type WageQuantitySource = 'provisional' | 'field'
export type WageCalculationPurpose = 'advance' | 'final'

export type WageQuantityRequest
  = | { purpose: 'advance', source: WageQuantitySource }
    | { purpose: 'final', source: 'field' }

export interface WageQuantityLine {
  provisionalQty: number | null
  fieldQty: number | null
}

export interface WageQuantityResolution {
  source: WageQuantitySource
  label: '暂估量' | '现场复核量'
  quantity: number | null
  status: 'ready' | 'missing'
}

export const WAGE_QUANTITY_SOURCE_OPTIONS: readonly {
  value: WageQuantitySource
  label: WageQuantityResolution['label']
}[] = [
  { value: 'provisional', label: '暂估量' },
  { value: 'field', label: '现场复核量' },
]

export function wageQuantityRequest(
  purpose: 'advance',
  source: WageQuantitySource,
): WageQuantityRequest
export function wageQuantityRequest(
  purpose: 'final',
): WageQuantityRequest
export function wageQuantityRequest(
  purpose: WageCalculationPurpose,
  source: WageQuantitySource = 'field',
): WageQuantityRequest {
  if (purpose === 'final')
    return { purpose, source: 'field' }
  return { purpose, source }
}

/**
 * 工资轨只消费暂估量或现场复核量。合同量不在输入类型中，也不做缺量回退：
 * 草稿/预付可显式选择两者，最终结算由请求类型固定为现场复核量。
 */
export function resolveWageQuantity(
  line: WageQuantityLine,
  request: WageQuantityRequest,
): WageQuantityResolution {
  const source = request.source
  const quantity = source === 'field' ? line.fieldQty : line.provisionalQty
  return {
    source,
    label: source === 'field' ? '现场复核量' : '暂估量',
    quantity,
    status: quantity == null ? 'missing' : 'ready',
  }
}
