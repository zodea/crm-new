import type { Supplier } from '~/stores/supplier'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUSES, SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { toNum } from '~/lib/util/number'

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function aliases(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map(text).filter(Boolean)
  return text(value).split(/[,，;；、]/).map(part => part.trim()).filter(Boolean)
}

function assignIfPresent<K extends keyof Supplier>(
  target: Partial<Supplier>,
  row: Record<string, unknown>,
  key: K,
  normalize: (value: unknown) => Supplier[K],
): void {
  if (Object.hasOwn(row, key))
    target[key] = normalize(row[key])
}

function supplierCategory(value: unknown): Supplier['supplierCategory'] {
  const category = text(value)
  return SUPPLIER_CATEGORIES.includes(category as (typeof SUPPLIER_CATEGORIES)[number])
    ? category
    : '其他'
}

function credentialStatus(value: unknown): Supplier['credentialStatus'] {
  const status = text(value)
  if (CREDENTIAL_STATUSES.includes(status as (typeof CREDENTIAL_STATUSES)[number]))
    return status
  return Object.entries(CREDENTIAL_STATUS_LABEL).find(([, label]) => label === status)?.[0] ?? 'incomplete'
}

/** 映射页签行 → 分供方 store 可写数据；拒绝空名并归一枚举、别名、数值。 */
export function normalizeSupplierImportRow(row: Record<string, unknown>): Partial<Supplier> {
  const name = text(row.name)
  if (!name)
    throw new Error('公司全称不能为空')

  const data: Partial<Supplier> = {
    name,
    source: 'excel',
  }

  assignIfPresent(data, row, 'externalRef', text)
  assignIfPresent(data, row, 'aliases', aliases)
  assignIfPresent(data, row, 'supplierCategory', supplierCategory)
  assignIfPresent(data, row, 'credentialStatus', credentialStatus)
  assignIfPresent(data, row, 'uniqueCode', text)
  assignIfPresent(data, row, 'taxNo', text)
  assignIfPresent(data, row, 'legalRep', text)
  assignIfPresent(data, row, 'registeredCapital', toNum)
  assignIfPresent(data, row, 'registeredDate', text)
  assignIfPresent(data, row, 'address', text)
  assignIfPresent(data, row, 'mainBusiness', text)
  assignIfPresent(data, row, 'businessType', text)
  assignIfPresent(data, row, 'invoiceName', text)
  assignIfPresent(data, row, 'taxpayerType', text)
  assignIfPresent(data, row, 'bank', text)
  assignIfPresent(data, row, 'bankAccount', text)
  assignIfPresent(data, row, 'invoiceAddress', text)
  assignIfPresent(data, row, 'phone', text)
  assignIfPresent(data, row, 'contact', text)
  assignIfPresent(data, row, 'contactPhone', text)
  assignIfPresent(data, row, 'rating', text)
  assignIfPresent(data, row, 'note', text)

  return data
}

/** 仅用于新增导入；重导更新不能套默认值，否则会覆盖未映射的既有资料。 */
export function withSupplierImportCreateDefaults(data: Partial<Supplier>): Partial<Supplier> {
  return {
    aliases: [],
    supplierCategory: '其他',
    credentialStatus: 'incomplete',
    ...data,
  }
}
