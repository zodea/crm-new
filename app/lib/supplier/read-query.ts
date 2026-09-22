import type { SupplierListColumnFilters, SupplierListNumericField, SupplierListTextField } from './read-contract'
import { normalizeEnumSelection } from '../util/enum-selection'
import { SUPPLIER_LIST_NUMERIC_FIELDS, SUPPLIER_LIST_TEXT_FIELDS, supplierProblem, SupplierRepositoryProblem } from './read-contract'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(): never {
  throw new SupplierRepositoryProblem(supplierProblem('invalid-query', '分供方列筛选条件无效'))
}

/** 单值旧链接、JSON 数组和重复查询参数统一成精确匹配选项；空数组表示不限。 */
export function normalizeSupplierEnumSelection(value: unknown): string[] {
  try {
    return normalizeEnumSelection(value)
  }
  catch {
    return invalid()
  }
}

export function serializeSupplierEnumSelection(value: unknown): string {
  const values = normalizeSupplierEnumSelection(value)
  return values.length > 1 ? JSON.stringify(values) : values[0] ?? ''
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
  if (!object(input) || Object.keys(input).some(key => !['contains', 'taxpayerType', 'businessLicense', 'ranges'].includes(key)))
    return invalid()
  const result: SupplierListColumnFilters = {}
  const businessLicense = normalizeSupplierEnumSelection(input.businessLicense)
  if (businessLicense.some(value => !['available', 'missing', 'unavailable'].includes(value)))
    return invalid()
  if (businessLicense.length)
    result.businessLicense = businessLicense as NonNullable<SupplierListColumnFilters['businessLicense']>
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
  const taxpayerTypes = normalizeSupplierEnumSelection(input.taxpayerType)
  if (taxpayerTypes.length)
    result.taxpayerType = taxpayerTypes
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
