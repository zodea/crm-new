export interface QuantityMeasureTotal {
  value: number | null
  knownValue: number | null
  sourceCount: number
  missingCount: number
  unitMissing: boolean
  completeness: 'complete' | 'partial'
}

export interface QuantityTotals {
  unit: string
  contractQty: QuantityMeasureTotal
  provisionalQty: QuantityMeasureTotal
  fieldQty: QuantityMeasureTotal
}

interface QuantityLineValues {
  unit: string
  contractQty: number | null
  provisionalQty: number | null
  fieldQty: number | null
}

/** 汇总值只在来源齐全时提供；已知部分与缺失项数分别保留。 */
export function quantityMeasureTotal(
  knownValue: number | null,
  sourceCount: number,
  missingCount: number,
  unit: string,
): QuantityMeasureTotal {
  const unitMissing = unit.trim() === ''
  const known = knownValue !== null && Number.isFinite(knownValue) ? knownValue : null
  const complete = !unitMissing && missingCount === 0 && (sourceCount === 0 || known !== null)
  return {
    value: complete ? known ?? 0 : null,
    knownValue: !unitMissing && sourceCount > missingCount ? known : null,
    sourceCount,
    missingCount,
    unitMissing,
    completeness: complete ? 'complete' : 'partial',
  }
}

/** 计量单位独立汇总；调用方负责按其业务粒度选择参与明细。 */
export function sumQuantityLines(lines: readonly QuantityLineValues[]): QuantityTotals[] {
  const groups = new Map<string, QuantityLineValues[]>()
  for (const line of lines) {
    const group = groups.get(line.unit) ?? []
    group.push(line)
    groups.set(line.unit, group)
  }
  function measure(rows: readonly QuantityLineValues[], field: 'contractQty' | 'provisionalQty' | 'fieldQty', unit: string) {
    const known = rows.map(row => row[field]).filter((value): value is number => value !== null && Number.isFinite(value))
    return quantityMeasureTotal(known.length ? known.reduce((sum, value) => sum + value, 0) : null, rows.length, rows.length - known.length, unit)
  }
  return [...groups].map(([unit, rows]) => ({
    unit,
    contractQty: measure(rows, 'contractQty', unit),
    provisionalQty: measure(rows, 'provisionalQty', unit),
    fieldQty: measure(rows, 'fieldQty', unit),
  }))
}
