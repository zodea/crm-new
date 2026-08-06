import type { ExportData } from '~/lib/kit/export'
import type { DeliveryRecord } from '~/stores/delivery-record'
import * as XLSX from 'xlsx'

export const DELIVERY_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface DeliveryExportRow {
  projectName: string
  supplierName: string
  orderNo: string
  deliveryDate: string
  materialName: string
  spec: string
  unit: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  sourceFile: string
  exception: string
}

const EXPORT_COLUMNS: readonly { key: keyof DeliveryExportRow, label: string, width: number }[] = [
  { key: 'projectName', label: '项目', width: 24 },
  { key: 'supplierName', label: '分供方', width: 30 },
  { key: 'orderNo', label: '送货单号', width: 20 },
  { key: 'deliveryDate', label: '日期', width: 14 },
  { key: 'materialName', label: '材料名称', width: 24 },
  { key: 'spec', label: '规格', width: 18 },
  { key: 'unit', label: '单位', width: 10 },
  { key: 'quantity', label: '数量', width: 12 },
  { key: 'unitPrice', label: '单价', width: 12 },
  { key: 'amount', label: '金额', width: 14 },
  { key: 'sourceFile', label: '原件名/页码', width: 30 },
  { key: 'exception', label: '异常说明', width: 34 },
]

export interface DeliveryExportResolvers {
  projectName: (id: string) => string
  supplierName: (id: string | null) => string
}

function rowException(record: DeliveryRecord, line: DeliveryRecord['lines'][number]): string {
  const reasons: string[] = []
  if (!record.hasSourceFile)
    reasons.push('缺少原件')
  if (!record.supplierId)
    reasons.push('未区分分供方')
  if (line.qty == null || line.unitPrice == null || line.amount == null)
    reasons.push('数量/金额缺失')
  if (record.reviewFlag)
    reasons.push(record.reviewFlag)
  if (record.note)
    reasons.push(record.note)
  return [...new Set(reasons)].join('；')
}

export function deliveryLedgerRows(
  records: readonly DeliveryRecord[],
  resolvers: DeliveryExportResolvers,
): DeliveryExportRow[] {
  return records
    .flatMap(record => record.lines.map(line => ({
      projectName: resolvers.projectName(record.projectId),
      supplierName: resolvers.supplierName(record.supplierId),
      orderNo: record.orderNo,
      deliveryDate: record.deliveryDate,
      materialName: line.materialName,
      spec: line.spec,
      unit: line.unit,
      quantity: line.qty,
      unitPrice: line.unitPrice,
      amount: line.amount,
      sourceFile: record.hasSourceFile ? `${record.fileName || '原件'} / —` : '—',
      exception: rowException(record, line),
    })))
    .sort((a, b) => a.projectName.localeCompare(b.projectName, 'zh-CN')
      || a.supplierName.localeCompare(b.supplierName, 'zh-CN')
      || a.orderNo.localeCompare(b.orderNo, 'zh-CN')
      || a.materialName.localeCompare(b.materialName, 'zh-CN'))
}

function excelDateValue(value: string): Date | string {
  const match = value.match(/^(\d{4})[-/]([01]\d)[-/]([0-3]\d)$/)
  if (!match)
    return value
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? value : date
}

function writeWorkbook(workbook: XLSX.WorkBook): ExportData {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer
}

export function createDeliveryLedgerXlsx(rows: readonly DeliveryExportRow[]): ExportData {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['送货单归档明细'],
    EXPORT_COLUMNS.map(column => column.label),
    ...rows.map(row => EXPORT_COLUMNS.map((column) => {
      if (column.key === 'deliveryDate')
        return excelDateValue(row.deliveryDate)
      return row[column.key]
    })),
  ])
  worksheet['!cols'] = EXPORT_COLUMNS.map(column => ({ wch: column.width }))
  worksheet['!merges'] = [{
    s: { r: 0, c: 0 },
    e: { r: 0, c: EXPORT_COLUMNS.length - 1 },
  }]

  for (let row = 2; row < rows.length + 2; row++) {
    const dateCell = worksheet[XLSX.utils.encode_cell({ r: row, c: 3 })]
    if (dateCell)
      dateCell.z = 'yyyy"年"m"月"d"日";@'
    for (const column of [7, 8, 9]) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })]
      if (cell && typeof cell.v === 'number')
        cell.z = '0.00_);[Red](0.00)'
    }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '送货单明细')
  return writeWorkbook(workbook)
}
