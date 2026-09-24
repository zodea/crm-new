import type { PayrollHollowSnapshot } from './central-hollow-deduction-contract'
import * as XLSX from 'xlsx'

/** 只消费本次发放的封闭原件；后来检查、整改和配置不参与输出。 */
export function payrollHollowFrozenRows(snapshot: PayrollHollowSnapshot) {
  return snapshot.facts.map((fact) => {
    const adoption = snapshot.adoptions.find(adoption => adoption.line.recordId === fact.recordId)
    return { 原记录身份: fact.recordId, 原检查修订: fact.inspection.revisionId, 原位置: fact.location.locationLabel, 原责任: fact.originalPartyName, 检查日期: fact.inspection.input.inspectedOn, 检查总处数: fact.inspection.input.count, 已整改处数: fact.rectifiedCount, 当时未整改处数: fact.remainingCount, 本单采用: adoption ? '已采用' : '未采用', 本单采用处数: adoption?.line.count ?? null, 采用单处金额: adoption?.line.unitAmount ?? null, 本单扣款金额: adoption?.line.amount ?? null, 原检查说明: fact.inspection.input.note }
  })
}
export function appendPayrollHollowSheets(book: XLSX.WorkBook, snapshot: PayrollHollowSnapshot) {
  const totals = snapshot.totals
  const summary = [{ 核算月份: snapshot.month, 原格式: snapshot.scope.formatFamily, 请款簿: snapshot.scope.book?.bookPurpose === 'management' ? '独立管理费簿' : snapshot.scope.formatFamily === 'A' ? '普通施工簿' : snapshot.scope.formatFamily, 本次请款合计: totals.claimSubtotal.value, 同簿此前已处理扣款: totals.previousProcessed.value, 本单空鼓扣款: totals.currentDeduction.value, 扣款后核算应发: totals.grossAmount.value, 原启动记录: snapshot.start?.id ?? null, 来源说明: snapshot.reasons.join('；') }]
  for (const [name, rows] of [['空鼓扣款汇总', summary], ['空鼓采用来源', payrollHollowFrozenRows(snapshot)]] as const) {
    const sheet = XLSX.utils.json_to_sheet(rows)
    sheet['!cols'] = Object.keys(rows[0] ?? {}).map(key => ({ wch: key.includes('位置') || key.includes('说明') ? 42 : key.includes('身份') || key.includes('修订') || key.includes('记录') ? 28 : 20 }))
    XLSX.utils.book_append_sheet(book, sheet, name)
  }
}
