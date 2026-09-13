import type { ExportFileOptions } from '../kit/export'
import type { PayrollAFrozenDocument } from './central-a-contract'
import * as XLSX from 'xlsx'

/** 页面只传后端已核准的冻结输出，不查询当前来源补齐。 */
export function createPayrollAWorkbook(document: PayrollAFrozenDocument): ExportFileOptions {
  const book = XLSX.utils.book_new()
  const sheets = [
    { name: '发放汇总', rows: [{ 项目: document.projectName, 月份: document.month, 班组: document.crewName, 负责人: document.leaderName, 档位: { monthly: '月度', settlement: '结算', retention: '尾款' }[document.periodKind], 支付比例: document.payRatio, 本期完成金额: document.workAmount, 累计应付: document.cumulativeAmount, 此前实际已发: document.previouslyPaid, 本次核算应发: document.grossAmount, 本次实际发放: document.actualAmount, 发放时间: document.releasedAt, 经办人: document.operatorName, 备注: document.note }] },
    { name: '工资明细', rows: document.lines.map((line, index) => ({ 序号: index + 1, 工人: line.workerName, 分项: line.itemName, 单位: line.unit, 完成现场量: line.quantity, 工资单价: line.unitPrice, 金额: line.amount, 签字确认并按手印: '' })) },
    { name: '组内分配', rows: document.allocations.map((allocation, index) => ({ 序号: index + 1, 收款人: allocation.workerName, 是否负责人: allocation.isLeader ? '是' : '否', 实际收款金额: allocation.amount, 签收: '' })) },
    { name: '此前实际发放', rows: document.previousPayments.map(item => ({ 工资单身份: item.statementId, 月份: item.month, 实际发放金额: item.amount })) },
  ]
  for (const sheet of sheets)
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheet.rows), sheet.name)
  const data: ArrayBuffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  const name = `${document.projectName}-${document.leaderName}-${document.month}-工资表`.replace(/[<>:"/\\|?*]/g, '-')
  return { data, defaultName: `${name}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
