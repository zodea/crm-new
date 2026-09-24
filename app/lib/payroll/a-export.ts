import type { ExportFileOptions } from '../kit/export'
import type { PayrollAFrozenDocument } from './central-a-contract'
import * as XLSX from 'xlsx'
import { appendPayrollAFeesSheets } from './a-fees-export'
import { payrollAFrozenFileName, payrollALocationOutput } from './a-location-output'
import { hasPayrollAFeesDocument } from './central-a-fees-contract'
import { appendPayrollHollowSheets } from './hollow-export'

/** 页面只传后端已核准的冻结输出，不查询当前来源补齐。 */
export function createPayrollAWorkbook(document: PayrollAFrozenDocument): ExportFileOptions {
  const book = XLSX.utils.book_new()
  const locations = payrollALocationOutput(document)
  const sheets = [
    { name: '发放汇总', rows: [{ 项目: document.projectName, 月份: document.month, 班组: document.crewName, 负责人: document.leaderName, 档位: { monthly: '月度', settlement: '结算', retention: '尾款' }[document.periodKind], 支付比例: document.payRatio, 本期完成金额: document.workAmount, 累计应付: document.cumulativeAmount, 此前实际已发: document.previouslyPaid, 本次核算应发: document.grossAmount, 本次实际发放: document.actualAmount, 发放时间: document.releasedAt, 经办人: document.operatorName, 备注: document.note }] },
    { name: '工资明细', rows: document.lines.map((line, index) => ({ 序号: index + 1, 工人: line.workerName, 分项: line.itemName, 单位: line.unit, 完成现场量: line.quantity, 工资单价: line.unitPrice, 金额: line.amount, 冻结施工范围: locations.lineNotes[line.id], 签字确认并按手印: '' })) },
    { name: '组内分配', rows: document.allocations.map((allocation, index) => ({ 序号: index + 1, 收款人: allocation.workerName, 是否负责人: allocation.isLeader ? '是' : '否', 实际收款金额: allocation.amount, 签收: '' })) },
    { name: '此前实际发放', rows: document.previousPayments.map(item => ({ 工资单身份: item.statementId, 月份: item.month, 实际发放金额: item.amount })) },
  ]
  for (const sheet of sheets)
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheet.rows), sheet.name)
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(locations.groups.flatMap(group => group.records.map(fact => ({ 原工资身份: document.id, 原工资行: fact.lineId, 楼栋: fact.buildingName, 分项: fact.itemName, 单位: fact.unit, 楼层范围: group.floors, 楼层: fact.floorName, 户: fact.unitName, 房间: fact.roomName, 原责任范围: fact.scopeKind === 'selected' ? '限定房间分项' : '原工种范围', 原现场量: fact.fieldQty, 原完成日期: fact.completedAt, 原责任身份: fact.assignmentId, 原完成身份: fact.completionId, 原范围身份: fact.ownershipKey })))), '原施工范围')
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(locations.diagnostics.map(reason => ({ 说明: reason }))), '施工范围说明')
  if (hasPayrollAFeesDocument(document))
    appendPayrollAFeesSheets(book, document)
  if (document.hollow)
    appendPayrollHollowSheets(book, document.hollow)
  const data: ArrayBuffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' })
  return { data, defaultName: payrollAFrozenFileName(document), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
