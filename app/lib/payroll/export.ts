import type { WageStatement } from './statements'
import type { ExportFileOptions } from '~/lib/kit/export'
import * as XLSX from 'xlsx'
import { createPayrollDocumentView } from './output'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function safeFilenamePart(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '-').trim() || '未命名'
}

function workbookBuffer(
  sheets: readonly { name: string, rows: readonly Record<string, unknown>[] }[],
): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([...sheet.rows]),
      sheet.name,
    )
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

export function createPayrollWorkbookExport(statement: WageStatement): ExportFileOptions {
  const document = createPayrollDocumentView(statement)
  const sheets: { name: string, rows: Record<string, unknown>[] }[] = [
    {
      name: '发放汇总',
      rows: [{
        项目: document.projectName,
        月份: document.month,
        班组: document.crewName,
        请款负责人: document.leaderName,
        格式族: document.formatFamily,
        取数口径: document.sourceLabel,
        累计应付: document.cumulativeAmount,
        此前已发: document.previouslyPaid,
        本次核算应发: document.grossAmount,
        本次实际发放: document.actualAmount,
        核对时间: document.checkedAt,
        发放时间: document.releasedAt,
        经办人: document.operatorName,
        备注: document.note,
      }],
    },
    {
      name: '工资明细',
      rows: document.wageRows.map((line, index) => ({
        序号: index + 1,
        工人: line.workerName,
        分项: line.itemName,
        单位: line.unit,
        工程量: line.quantity,
        工资单价: line.unitPrice,
        分项金额: line.amount,
        签字确认并按手印: '',
      })),
    },
    {
      name: '组内分配',
      rows: document.allocationRecorded
        ? document.allocations.map((allocation, index) => ({
            序号: index + 1,
            收款人: allocation.workerName,
            是否负责人: allocation.isLeader ? '是' : '否',
            实际收款金额: allocation.amount,
            签收: '',
          }))
        : [{
            序号: '',
            收款人: '历史工资单未记录组内分配',
            是否负责人: '',
            实际收款金额: '',
            签收: '',
          }],
    },
  ]

  if (document.formatFamily === 'C2') {
    sheets.push({
      name: '零星签工',
      rows: document.dayworkRecords.map((record, index) => ({
        序号: index + 1,
        日期: record.workDate,
        施工内容: record.workContent,
        开始时间: record.startTime,
        结束时间: record.endTime,
        用工人: record.workerName,
        用工数: record.laborUnits,
        证明人: record.witness,
        确认日期: record.confirmedOn,
        备注: record.note,
      })),
    })
  }

  return {
    data: workbookBuffer(sheets),
    defaultName: [
      safeFilenamePart(document.projectName),
      safeFilenamePart(document.month),
      safeFilenamePart(document.leaderName),
      '工资表.xlsx',
    ].join('_'),
    mimeType: XLSX_MIME,
  }
}
