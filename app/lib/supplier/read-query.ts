import type { SupplierListColumnFilters, SupplierListNumericField, SupplierListTextField } from './read-contract'
import { SUPPLIER_LIST_NUMERIC_FIELDS, SUPPLIER_LIST_TEXT_FIELDS, supplierProblem, SupplierRepositoryProblem } from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new SupplierRepositoryProblem(supplierProblem('invalid-query', '分供方列筛选条件无效'))
}

/** 旧客户端不传条件时保持兼容，未知字段与畸形区间在服务器边界拒绝。 */
export function parseSupplierColumnFilters(value: unknown): SupplierListColumnFilters | undefined {
  if (value === undefined || value === null || value === '')
    return undefined
  let input = value
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    }
    catch {
      return invalid()
    }
  }
  if (!object(input) || Object.keys(input).some(key => !['contains', 'taxpayerType', 'ranges'].includes(key)))
    return invalid()
  const result: SupplierListColumnFilters = {}
  if (input.contains !== undefined) {
    if (!object(input.contains))
      return invalid()
    const contains: NonNullable<SupplierListColumnFilters['contains']> = {}
    for (const [field, text] of Object.entries(input.contains)) {
      if (!SUPPLIER_LIST_TEXT_FIELDS.includes(field as SupplierListTextField) || typeof text !== 'string')
        return invalid()
      if (text.trim())
        contains[field as SupplierListTextField] = text.trim()
    }
    if (Object.keys(contains).length)
      result.contains = contains
  }
  if (input.taxpayerType !== undefined && input.taxpayerType !== null) {
    if (typeof input.taxpayerType !== 'string')
      return invalid()
    if (input.taxpayerType.trim())
      result.taxpayerType = input.taxpayerType.trim()
  }
  if (input.ranges !== undefined) {
    if (!object(input.ranges))
      return invalid()
    const ranges: NonNullable<SupplierListColumnFilters['ranges']> = {}
    for (const [field, bounds] of Object.entries(input.ranges)) {
      if (!SUPPLIER_LIST_NUMERIC_FIELDS.includes(field as SupplierListNumericField) || !object(bounds)
        || Object.keys(bounds).some(key => !['min', 'max'].includes(key))) {
        return invalid()
      }
      const range: { min?: number, max?: number } = {}
      for (const edge of ['min', 'max'] as const) {
        if (bounds[edge] !== undefined) {
          if (typeof bounds[edge] !== 'number' || !Number.isFinite(bounds[edge]))
            return invalid()
          range[edge] = bounds[edge]
        }
      }
      if (range.min !== undefined && range.max !== undefined && range.min > range.max)
        return invalid()
      if (Object.keys(range).length)
        ranges[field as SupplierListNumericField] = range
    }
    if (Object.keys(ranges).length)
      result.ranges = ranges
  }
  return Object.keys(result).length ? result : undefined
}
