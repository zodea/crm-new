import type { ExportFileOptions } from '../kit/export'
import type { PayrollNumberingRead } from './central-numbering-contract'
import * as XLSX from 'xlsx'
import { createPayrollAWorkbook } from './a-export'
import { createPayrollC1Workbook } from './c1-export'
import { createPayrollC2Workbook } from './c2-export'
import { payrollProblem } from './central-contract'

/** Only a successful authorized read can label a frozen original as officially issued. */
export function payrollOfficialDocument(read: PayrollNumberingRead) {
  const { issue, document } = read
  if (!read.eligibility.canDownload || !issue || !document || read.context.origin !== 'real'
    || !read.context.capabilities.includes('payroll:read') || issue.statementId !== document.id
    || issue.projectId !== document.projectId || issue.formatFamily !== document.formatFamily) {
    throw payrollProblem('unavailable', '尚未读回这份工资的正式出具记录，不能生成正式文件')
  }
  return { issue, document }
}

export function payrollOfficialFilename(read: PayrollNumberingRead): string {
  const { issue, document } = payrollOfficialDocument(read)
  const label = [...`${document.projectName.slice(0, 36)}-${document.leaderName.slice(0, 16)}-${document.month}-${document.formatFamily}-正式${issue.number}`].map(char => char.charCodeAt(0) < 32 ? '-' : char).join('').replace(/[<>:"/\\|?*]/g, '-')
  // Keep the complete frozen-document digest: shortened display names cannot overwrite another original.
  return `${label}-${issue.documentHash}.xlsx`
}

export function createPayrollOfficialWorkbook(read: PayrollNumberingRead): ExportFileOptions {
  const { issue, document } = payrollOfficialDocument(read)
  const original = document.formatFamily === 'A' ? createPayrollAWorkbook(document) : document.formatFamily === 'C1' ? createPayrollC1Workbook(document) : createPayrollC2Workbook(document)
  if (!(original.data instanceof ArrayBuffer))
    throw payrollProblem('unavailable', '冻结工资文件正文不可读取')
  const book = XLSX.read(original.data, { type: 'array' })
  const rows = [
    ['正式工资编号', String(issue.number)],
    ['项目', document.projectName],
    ['项目身份', issue.projectId],
    ['原工资身份', issue.statementId],
    ['格式', issue.formatFamily],
    ['月份', document.month],
    ['档位', document.formatFamily === 'A' ? { monthly: '月度请款', settlement: '工程结算', retention: '尾款' }[document.periodKind] : '月度100%'],
    ['核算应发', document.grossAmount],
    ['原实际发放', document.actualAmount],
    ['原发放时间', document.releasedAt],
    ['正式出具时间', issue.issuedAt],
    ['出具操作者', issue.operatorId],
    ['出具记录', issue.id],
    ['冻结原件摘要', issue.documentHash],
    ['说明', '本编号只标记正式出具，不重算或新增工资、实际付款；重复下载沿用原号。'],
  ]
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), '正式出具')
  book.SheetNames = ['正式出具', ...book.SheetNames.filter(name => name !== '正式出具')]
  return { data: XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer, defaultName: payrollOfficialFilename(read), mimeType: original.mimeType }
}
