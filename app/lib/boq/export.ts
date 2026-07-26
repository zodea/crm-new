import type { MonthlyStatementView } from './monthly'
import type { BoqWorkspace } from './read-model'
import type { ExportFileOptions } from '~/lib/kit/export'
import * as XLSX from 'xlsx'
import { BOQ_CHANGE_STATUS_LABEL, BOQ_MONTHLY_STATUS_LABEL } from './presentation'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function localDateStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function workbookBuffer(sheets: readonly { name: string, rows: readonly Record<string, unknown>[] }[]): ArrayBuffer {
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

export function createBoqWorkbookExport(
  workspace: BoqWorkspace,
  now = new Date(),
): ExportFileOptions {
  return {
    data: workbookBuffer([
      {
        name: '合同清单',
        rows: workspace.lines.map(line => ({
          分部: line.section,
          工种: line.trade,
          分项名称: line.itemName,
          户型: line.unitType,
          房间部位: line.room,
          单位: line.unit,
          合同工程量: line.effectiveQty,
          合同单价: line.effectiveUnitPrice,
          合价: line.effectiveAmount,
          已签证变更额: line.approvedChangeAmount,
          甲供材: line.ownerSupplied ? '是' : '否',
          来源: line.traceKey || (line.changeOrderId ? `变更单·${line.changeOrderId}` : ''),
          手工修正: line.manuallyCorrected ? '是' : '否',
        })),
      },
      {
        name: '变更单',
        rows: workspace.changes.map(change => ({
          变更编号: change.code,
          变更名称: change.name,
          类型: change.changeType,
          状态: BOQ_CHANGE_STATUS_LABEL[change.status],
          甲方指令单: change.directiveNo,
          变更金额: change.totalAmount,
          签证日期: change.approvedAt ?? '',
          台账追溯ID: change.ledgerId ?? '',
          附件数: change.attachmentCount,
          状态说明: change.statusNote,
        })),
      },
      {
        name: '月度报量',
        rows: workspace.monthlyStatements.map(statement => ({
          月份: statement.month,
          状态: BOQ_MONTHLY_STATUS_LABEL[statement.status],
          报量金额: statement.totalAmount,
          备注: statement.note,
        })),
      },
    ]),
    defaultName: `${workspace.projectName}_${workspace.contractName}_BOQ台账_${localDateStamp(now)}.xlsx`,
    mimeType: XLSX_MIME,
  }
}

export function createMonthlyStatementExport(
  statement: MonthlyStatementView,
  projectName: string,
  contractName: string,
): ExportFileOptions {
  return {
    data: workbookBuffer([{
      name: `${statement.month}月度报量`,
      rows: statement.lines.map(line => ({
        分项名称: line.itemName,
        单位: line.unit,
        自动量: line.autoQty,
        手调量: line.adjustedQty,
        本期报量: line.effectiveQty,
        合同单价: line.unitPrice,
        合价: line.amount,
        手调说明: line.note,
      })),
    }]),
    defaultName: `${projectName}_${contractName}_${statement.month}月度报量.xlsx`,
    mimeType: XLSX_MIME,
  }
}
