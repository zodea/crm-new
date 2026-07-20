// 工程量导出（ADR 0004 / #103 切片 6B）：数据一律来自统一派生查询（derived.ts），
// 页面、工资预览与导出共用同一口径，不建导出专用副本。
import type { ConfiguredExportPlanOptions, ExportFileOptions } from '~/lib/kit/export'
import type {
  QuantityConstructionRecord,
  QuantityMonthlyOutput,
  QuantityStageProgress,
} from '~/lib/quantity/derived'
import * as XLSX from 'xlsx'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type QuantityCategoryExportOptions = ConfiguredExportPlanOptions & {
  requiresDirectoryStructure: true
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  draft: '草稿',
}

/** 施工记录台账列：与户详情/派生记录同字段序。 */
export const QUANTITY_RECORD_EXPORT_COLUMNS = [
  { key: 'buildingName', label: '楼栋' },
  { key: 'floorName', label: '楼层' },
  { key: 'unitName', label: '户' },
  { key: 'trade', label: '工种' },
  { key: 'stageName', label: '工序阶段' },
  { key: 'status', label: '状态' },
  { key: 'completedAt', label: '完成日期' },
  { key: 'executionAssigneeName', label: '完成时执行责任' },
  { key: 'currentAssigneeName', label: '当前责任' },
  { key: 'photoCount', label: '验收照片数' },
  { key: 'note', label: '备注' },
] as const

export function quantityRecordRows(
  records: readonly QuantityConstructionRecord[],
): Record<string, string | number>[] {
  return records.map(record => Object.fromEntries(
    QUANTITY_RECORD_EXPORT_COLUMNS.map((column) => {
      const value = record[column.key]
      if (column.key === 'status')
        return [column.label, STATUS_LABEL[record.status] ?? record.status]
      if (typeof value === 'number')
        return [column.label, value]
      return [column.label, value ?? '']
    }),
  ))
}

export function quantityProgressRows(
  progress: readonly QuantityStageProgress[],
): Record<string, string | number>[] {
  return progress.map(stage => ({
    工种: stage.trade,
    工序阶段: stage.stageName,
    应做户数: stage.applicableUnits,
    已完成户数: stage.completedUnits,
    草稿户数: stage.draftUnits,
    完成率: stage.applicableUnits ? `${Math.round(stage.completionRate * 100)}%` : '—',
  }))
}

export function quantityMonthlyRows(
  monthly: readonly QuantityMonthlyOutput[],
): Record<string, string | number>[] {
  return monthly.map(row => ({
    月份: row.month,
    工种: row.trade,
    工序阶段: row.stageName,
    完成户数: row.completedUnits,
    合同量: row.contractQty,
    暂定量: row.provisionalQty,
    现场量: row.fieldQty,
  }))
}

function sheetsToXlsx(sheets: readonly { name: string, rows: Record<string, unknown>[] }[]): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet.rows), sheet.name)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** 使用本地日历日，避免北京时间凌晨被 UTC 日期回拨到前一天。 */
function localDateStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface QuantityLedgerExportInput {
  projectName: string
  records: readonly QuantityConstructionRecord[]
  progress: readonly QuantityStageProgress[]
  monthly: readonly QuantityMonthlyOutput[]
}

/** ADR 0004 路一：施工记录 + 阶段进度 + 月度完成量三 sheet 单文件直接保存。 */
export function createQuantityLedgerExport(
  input: QuantityLedgerExportInput,
  now = new Date(),
): ExportFileOptions {
  return {
    data: sheetsToXlsx([
      { name: '施工记录', rows: quantityRecordRows(input.records) },
      { name: '阶段进度', rows: quantityProgressRows(input.progress) },
      { name: '月度完成量', rows: quantityMonthlyRows(input.monthly) },
    ]),
    defaultName: `${input.projectName || '工程量'}_工程量台账_${localDateStamp(now)}.xlsx`,
    mimeType: XLSX_MIME,
  }
}

/** ADR 0004 路二：楼栋 → 工种两级目录、逐户一文件的分类导出计划。 */
export function createQuantityCategoryExport(
  records: readonly QuantityConstructionRecord[],
): QuantityCategoryExportOptions {
  const byUnitTrade = new Map<string, QuantityConstructionRecord[]>()
  for (const record of records) {
    const key = `${record.unitId} ${record.trade}`
    const list = byUnitTrade.get(key) ?? []
    list.push(record)
    byUnitTrade.set(key, list)
  }
  return {
    requiresDirectoryStructure: true,
    source: {
      label: '工程量施工记录',
      fields: [
        { key: 'buildingName', label: '楼栋' },
        { key: 'trade', label: '工种' },
        { key: 'floorName', label: '楼层' },
        { key: 'unitName', label: '户' },
      ],
      files: [...byUnitTrade.values()].map(group => ({
        row: {
          buildingName: group[0]!.buildingName,
          trade: group[0]!.trade,
          floorName: group[0]!.floorName,
          unitName: group[0]!.unitName,
        },
        data: sheetsToXlsx([{ name: '施工记录', rows: quantityRecordRows(group) }]),
        mimeType: XLSX_MIME,
      })),
    },
    structure: {
      levels: [
        { field: 'buildingName', fallback: '未分楼栋' },
        { field: 'trade', fallback: '未分工种' },
      ],
    },
    naming: {
      parts: [
        { field: 'floorName', fallback: '未分楼层' },
        { field: 'unitName', fallback: '未命名户' },
      ],
      extension: 'xlsx',
    },
  }
}
