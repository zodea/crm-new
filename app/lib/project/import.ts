import type { CustomerListItemDTO } from '../customer/read-contract'
import type { ProjectFormDraft } from '../master-data/forms'
import type { RawImportSheet } from '../util/excel'
import { IMPORT_SOURCE_META_KEY } from '../kit/import-mapping'
import { decodeProjectFormDraft } from './command-validation'
import { normalizeProjectStatus } from './status'

export interface ProjectImportSource {
  fileName: string
  fileDigest: string
  sheetName: string
  rowNumber: number
  externalRef: string
  rawSnapshot: Record<string, unknown>
}

export function projectImportSource(row: Record<string, unknown>): ProjectImportSource | undefined {
  return row[IMPORT_SOURCE_META_KEY] as ProjectImportSource | undefined
}

export function annotateProjectImportRows(rows: Record<string, unknown>[], sheet: RawImportSheet): Record<string, unknown>[] {
  return rows.map((row, index) => Object.defineProperty(row, IMPORT_SOURCE_META_KEY, { value: {
    fileName: sheet.sourceFileName ?? '导入.xlsx',
    fileDigest: sheet.sourceHash ?? '',
    sheetName: sheet.name,
    rowNumber: sheet.rowNumbers?.[index] ?? sheet.headerRow + index + 2,
    externalRef: String(row.externalRef ?? '').trim(),
    rawSnapshot: { ...sheet.rows[index] },
  }, configurable: true }))
}

export function decodeProjectImportSource(value: unknown): ProjectImportSource {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('缺少项目导入来源，请重新选择文件')
  const source = value as Record<string, unknown>
  if (typeof source.fileName !== 'string' || !source.fileName.trim()
    || typeof source.fileDigest !== 'string' || !/^[a-f0-9]{64}$/.test(source.fileDigest)
    || typeof source.sheetName !== 'string' || !source.sheetName.trim()
    || !Number.isSafeInteger(source.rowNumber) || Number(source.rowNumber) < 1
    || typeof source.externalRef !== 'string'
    || !source.rawSnapshot || typeof source.rawSnapshot !== 'object' || Array.isArray(source.rawSnapshot)) {
    throw new Error('项目导入来源信息无效')
  }
  return { fileName: source.fileName, fileDigest: source.fileDigest, sheetName: source.sheetName, rowNumber: Number(source.rowNumber), externalRef: source.externalRef.trim(), rawSnapshot: { ...source.rawSnapshot as Record<string, unknown> } }
}

export function projectImportSourceKey(source: ProjectImportSource): string {
  return JSON.stringify([source.fileDigest, source.sheetName, source.rowNumber])
}

export function matchesProjectImportSource(stored: ProjectImportSource | undefined, incoming: ProjectImportSource): boolean {
  return !!stored && (projectImportSourceKey(stored) === projectImportSourceKey(incoming)
    || (!!incoming.externalRef && stored.externalRef === incoming.externalRef))
}

export function assertImportCustomerAvailable(customer: CustomerListItemDTO, label: string): void {
  if (customer.status === 'inactive')
    throw new Error(`${label}“${customer.customer.label}”已停用，请先核对客户资料`)
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

export function resolveImportCustomer(reference: unknown, customers: readonly CustomerListItemDTO[], label: string, required = false): string | null {
  const value = text(reference)
  if (!value) {
    if (required)
      throw new Error(`${label}不能为空`)
    return null
  }
  const normalize = (input: string) => input.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
  const real = customers.filter(item => item.dataOrigin === 'real')
  const ids = real.filter(item => item.customer.id === value)
  const matches = ids.length ? ids : real.filter(item => [item.customer.label, ...item.aliases].some(name => normalize(name) === normalize(value)))
  if (!matches.length)
    throw new Error(`${label}“${value}”不存在、已失效或不在正式可读范围内`)
  if (matches.length !== 1)
    throw new Error(`${label}“${value}”存在歧义，请改用客户稳定 ID`)
  assertImportCustomerAvailable(matches[0]!, label)
  return matches[0]!.customer.id
}

/** 只接受现行模板字段；归一结果进入人工预览和正式保存。 */
export function projectDraftFromImport(row: Record<string, unknown>, customers: readonly CustomerListItemDTO[]): ProjectFormDraft {
  const fields = ['name', 'contractName', 'operationType', 'region', 'address', 'manager', 'execManager', 'builder', 'startDate', 'plannedEnd', 'note'] as const
  const draft: ProjectFormDraft = Object.fromEntries(fields.map(key => [key, text(row[key])]))
  if (!draft.name)
    throw new Error('项目名称为必填项')
  if (!draft.manager)
    throw new Error('项目经理为必填项')
  draft.customerId = resolveImportCustomer(row.customerName, customers, '客户', true)
  draft.secondaryCustomerId = resolveImportCustomer(row.secondaryCustomerName, customers, '次客户')
  draft.status = normalizeProjectStatus(text(row.status))
  return decodeProjectFormDraft(draft)
}
