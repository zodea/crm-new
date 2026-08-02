/**
 * 工程量取数基准的权威定义。
 *
 * 当前消费方：进度款报量（`~/lib/boq/monthly`）与甲方报量单。
 * 量差总表（`~/lib/quantity/variance` 的 `QuantityVarianceBasis`）和工资轨
 * （`~/lib/quantity/wage-source`）仍各自持有同名枚举与标签，尚未收编到此处；
 * 迁移它们属于独立工作单元，在完成前不要把本文件描述成全域唯一定义。
 *
 * 工资轨只允许 provisional / field，该收窄规则由 `~/lib/quantity/wage-source`
 * 单独承载，不在此处放宽。
 */
export type QuantityBasis = 'contract' | 'provisional' | 'field'

export const QUANTITY_BASIS_LABELS: Readonly<Record<QuantityBasis, string>> = {
  contract: '合同量',
  provisional: '暂估量',
  field: '现场复核量',
}

/**
 * 基准到 `house_type_template_items` 列名的映射。
 *
 * 值经 `as const` 收窄为字面量联合，保证插入 SQL 的列名可证明来自这三个常量，
 * 不会退化成任意 string。新增消费方应走此表而不是自行拼列名。
 */
export const QUANTITY_BASIS_COLUMNS = {
  contract: 'contract_qty',
  provisional: 'provisional_qty',
  field: 'field_qty',
} as const satisfies Record<QuantityBasis, string>

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
