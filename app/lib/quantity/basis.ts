/**
 * 工程量取数基准的单一权威定义。
 *
 * 量差总表、进度款报量与工资核算都从这里取基准的枚举、列名与显示名，
 * 避免各自维护第二份口径。工资轨只允许 provisional / field，
 * 该收窄规则由 `~/lib/quantity/wage-source` 单独承载，不在此处放宽。
 */
export type QuantityBasis = 'contract' | 'provisional' | 'field'

export const QUANTITY_BASIS_LABELS: Readonly<Record<QuantityBasis, string>> = {
  contract: '合同量',
  provisional: '暂估量',
  field: '现场复核量',
}

/** 基准到 `house_type_template_items` 列名的映射；调用方必须走此表，不得自行拼列名。 */
export const QUANTITY_BASIS_COLUMNS: Readonly<Record<QuantityBasis, string>> = {
  contract: 'contract_qty',
  provisional: 'provisional_qty',
  field: 'field_qty',
}

export const QUANTITY_BASIS_OPTIONS: readonly {
  value: QuantityBasis
  label: string
}[] = [
  { value: 'contract', label: QUANTITY_BASIS_LABELS.contract },
  { value: 'provisional', label: QUANTITY_BASIS_LABELS.provisional },
  { value: 'field', label: QUANTITY_BASIS_LABELS.field },
]

export function isQuantityBasis(value: unknown): value is QuantityBasis {
  return value === 'contract' || value === 'provisional' || value === 'field'
}

export function quantityBasisLabel(basis: QuantityBasis): string {
  return QUANTITY_BASIS_LABELS[basis]
}

export function assertQuantityBasis(value: unknown): asserts value is QuantityBasis {
  if (!isQuantityBasis(value))
    throw new Error('取数基准只能是合同量、暂估量或现场复核量')
}
