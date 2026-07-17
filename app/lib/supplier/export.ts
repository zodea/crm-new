import type { ConfiguredExportPlanOptions, ExportFileOptions } from '~/lib/kit/export'
import type { Supplier } from '~/stores/supplier'
import * as XLSX from 'xlsx'
import { CREDENTIAL_STATUS_LABEL } from '~/lib/supplier/status'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type SupplierCategoryExportOptions = ConfiguredExportPlanOptions & {
  requiresDirectoryStructure: true
}

export type SupplierExportable = Omit<Supplier, 'aliases'> & {
  aliases: readonly string[]
}

export interface SupplierExportColumn {
  key: keyof SupplierExportable
  label: string
}

/** 分供方台账导出列；顺序同时用于单文件台账与分类导出的逐户文件。 */
export const SUPPLIER_EXPORT_COLUMNS: readonly SupplierExportColumn[] = [
  { key: 'name', label: '公司全称' },
  { key: 'externalRef', label: '外部旧ID / 匹配标识' },
  { key: 'aliases', label: '简称/别名' },
  { key: 'supplierCategory', label: '分供方类别' },
  { key: 'credentialStatus', label: '资料状态' },
  { key: 'uniqueCode', label: '统一社会信用代码' },
  { key: 'taxNo', label: '税号' },
  { key: 'legalRep', label: '法定代表人' },
  { key: 'registeredCapital', label: '注册资金（万元）' },
  { key: 'registeredDate', label: '注册日期' },
  { key: 'address', label: '注册地址' },
  { key: 'mainBusiness', label: '主营业务' },
  { key: 'businessType', label: '业务类型' },
  { key: 'invoiceName', label: '开票名称' },
  { key: 'taxpayerType', label: '纳税人类型' },
  { key: 'bank', label: '开户行' },
  { key: 'bankAccount', label: '银行账号' },
  { key: 'invoiceAddress', label: '开票地址' },
  { key: 'phone', label: '电话' },
  { key: 'contact', label: '主要联系人' },
  { key: 'contactPhone', label: '联系方式' },
  { key: 'rating', label: '评价等级' },
  { key: 'note', label: '备注' },
]

function supplierCell(supplier: SupplierExportable, key: keyof SupplierExportable): string | number {
  const value = supplier[key]
  if (key === 'aliases')
    return supplier.aliases.join('、')
  if (key === 'credentialStatus')
    return CREDENTIAL_STATUS_LABEL[supplier.credentialStatus] ?? supplier.credentialStatus
  if (value == null)
    return ''
  return typeof value === 'number' ? value : String(value)
}

/** 把分供方集投影为中文表头台账行。 */
export function supplierLedgerRows(
  suppliers: readonly SupplierExportable[],
): Record<string, string | number>[] {
  return suppliers.map(supplier => Object.fromEntries(
    SUPPLIER_EXPORT_COLUMNS.map(column => [column.label, supplierCell(supplier, column.key)]),
  ))
}

function rowsToXlsx(rows: Record<string, unknown>[], sheetName: string): ArrayBuffer {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** 使用本地日历日，避免北京时间凌晨被 UTC 日期回拨到前一天。 */
export function localDateStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** ADR 0004 路一：把当前筛选集编译为可直接保存的单文件台账请求。 */
export function createSupplierLedgerExport(
  suppliers: readonly SupplierExportable[],
  now = new Date(),
): ExportFileOptions {
  return {
    data: rowsToXlsx(supplierLedgerRows(suppliers), '分供方台账'),
    defaultName: `分供方台账_${localDateStamp(now)}.xlsx`,
    mimeType: XLSX_MIME,
  }
}

/** ADR 0004 路二：把当前筛选集编译为类别/资料状态两级目录的逐户文件计划。 */
export function createSupplierCategoryExport(
  suppliers: readonly SupplierExportable[],
): SupplierCategoryExportOptions {
  return {
    requiresDirectoryStructure: true,
    source: {
      label: '分供方资料',
      fields: [
        { key: 'supplierCategory', label: '分供方类别' },
        { key: 'credentialStatus', label: '资料状态' },
        { key: 'name', label: '公司全称' },
        { key: 'rating', label: '评价等级' },
      ],
      files: suppliers.map(supplier => ({
        row: {
          supplierCategory: supplier.supplierCategory,
          credentialStatus: CREDENTIAL_STATUS_LABEL[supplier.credentialStatus] ?? supplier.credentialStatus,
          name: supplier.name,
          rating: supplier.rating,
        },
        data: rowsToXlsx(supplierLedgerRows([supplier]), '分供方'),
        mimeType: XLSX_MIME,
      })),
    },
    structure: {
      levels: [
        { field: 'supplierCategory', fallback: '未分类' },
        { field: 'credentialStatus', fallback: '资料状态未填' },
      ],
    },
    naming: {
      parts: [{ field: 'name', fallback: '未命名分供方' }],
      extension: 'xlsx',
    },
  }
}
