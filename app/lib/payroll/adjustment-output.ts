import type { ExportFileOptions } from '../kit/export'
import type { PayrollActualPaymentDetailRead } from './central-actual-contract'
import type { PayrollAdjustmentBasisDraft, PayrollAdjustmentDetailRead, PayrollOriginalWageRef } from './central-adjustment-contract'
import * as XLSX from 'xlsx'

type Cell = string | number | null
export interface PayrollConfirmationDocument { id: string, title: string, sections: Array<{ title: string, columns: string[], rows: Cell[][] }> }
const originalRows = (originals: PayrollOriginalWageRef[]): Cell[][] => originals.map(o => [o.statementId, o.projectName, o.month, o.formatFamily, o.originalGrossAmount.value, o.originalSignatureAmount.value])
function basisRows(basis: PayrollAdjustmentBasisDraft | null): Cell[][] {
  if (!basis)
    return [['原依据未完整记录']]
  if (basis.formatFamily === 'A')
    return [['采用比例', basis.payRatio], ...basis.components.map(row => [row.ownershipKey, row.priceRevisionId, row.quantity, row.unitPrice])]
  if (basis.formatFamily === 'C1')
    return [...basis.rates.map(row => [row.workerId, '日薪 / 加班标准', row.dailyWage, row.overtimeRate, row.overtimeRule]), ...basis.records.map(row => [row.recordId, row.workerId, row.workDate, row.hours, row.overtimeHours, row.workContent])]
  return [['主体单价', basis.unitRate, '配置', basis.configId], ...basis.records.map(row => [row.recordId, row.workerId, row.workDate, row.laborUnits, `${row.startTime}—${row.endTime}`, row.workContent, row.witness, row.confirmedOn])]
}
const originalSection = (originals: PayrollOriginalWageRef[]) => ({ title: '原工资签名事实', columns: ['原工资', '原项目', '月份', '格式', '原核算', '原签名实发'], rows: originalRows(originals) })
export function payrollAdjustmentConfirmation(read: PayrollAdjustmentDetailRead): PayrollConfirmationDocument | null {
  const snapshot = read.adjustment.snapshot
  if (read.adjustment.status !== 'confirmed' || !snapshot || snapshot.id !== read.adjustment.id || snapshot.preview.delta.state !== 'known')
    return null
  return { id: snapshot.id, title: '独立工资核算更正确认记录', sections: [originalSection([snapshot.original]), { title: '本次确认事实（不表示已经收付）', columns: ['项目', '内容'], rows: [['更正编号', snapshot.id], ['前序更正', snapshot.correctsAdjustmentId], ['更正原因', snapshot.reason], ['核对依据', snapshot.evidenceNote], ['更正前核算', snapshot.preview.beforeAmount.value], ['更正后核算', snapshot.preview.afterAmount.value], ['本次有符号差额', snapshot.preview.delta.value], ['确认人', snapshot.confirmedBy], ['确认时间', snapshot.confirmedAt]] }, { title: '更正前冻结依据', columns: ['来源 / 项目', '身份 / 值', '日期 / 数量', '数量 / 单价', '标准 / 时段', '工作内容', '证明人', '确认日期'], rows: basisRows(snapshot.preview.before) }, { title: '本次采用依据', columns: ['来源 / 项目', '身份 / 值', '日期 / 数量', '数量 / 单价', '标准 / 时段', '工作内容', '证明人', '确认日期'], rows: basisRows(snapshot.preview.after) }, { title: '当前处理历史（后来事实，与原确认分别保留）', columns: ['处理编号', '种类', '处理差额', '真实收付来源'], rows: read.applications.map(row => [row.id, row.kind === 'later-release' ? '后续工资处理' : row.kind === 'recording-reversal' ? '错记冲销' : '实际补退', row.appliedDelta.value, row.fact?.identity ?? '原事实暂未核实']) }, { title: '当前余额', columns: ['已确认差额', '已处理差额', '待处理差额'], rows: [[read.balance.confirmedDelta.value, read.balance.appliedDelta.value, read.balance.remainingDelta.value]] }] }
}
export function payrollActualConfirmation(read: PayrollActualPaymentDetailRead): PayrollConfirmationDocument | null {
  const { snapshot, fact } = read
  if (fact.qualification !== 'proven' || fact.ref.kind !== 'actual-event' || fact.ref.eventId !== snapshot.id || fact.signedAmount.state !== 'known')
    return null
  const reversal = 'kind' in snapshot && snapshot.kind === 'recording-reversal'
  const date = 'confirmedOn' in snapshot.draft ? snapshot.draft.confirmedOn : snapshot.draft.occurredOn
  return { id: snapshot.id, title: reversal ? '工资错记冲销确认记录' : fact.kind === 'refund' ? '工资实际退款确认记录' : '工资实际补发确认记录', sections: [originalSection(snapshot.originals), { title: reversal ? '本次错记冲销（不是工人退款）' : '本次真实收付', columns: ['项目', '内容'], rows: [['记录编号', snapshot.id], ['发生 / 核实日期', date], ['有符号登记金额', fact.signedAmount.value], ['核对依据', snapshot.draft.evidenceNote], ['确认人', snapshot.confirmedBy], ['确认时间', snapshot.confirmedAt], ['原错记事实', reversal && 'originalFact' in snapshot ? snapshot.originalFact.identity : null]] }, { title: reversal ? '原分配对应的冲销效果' : '本次实际收付成员', columns: ['原成员身份', '当时姓名', '有符号金额'], rows: fact.allocations.map(row => [row.workerId, row.workerName, row.amount]) }, { title: '关联更正与处理', columns: ['更正', '本次处理金额'], rows: snapshot.draft && 'applications' in snapshot.draft ? snapshot.draft.applications.map(row => [row.adjustmentId, row.amount]) : 'applications' in snapshot ? snapshot.applications.map(row => [row.adjustmentId, row.amount]) : [] }] }
}
export function createPayrollConfirmationWorkbook(document: PayrollConfirmationDocument): ExportFileOptions {
  const book = XLSX.utils.book_new()
  document.sections.forEach((section, index) => {
    const sheet = XLSX.utils.aoa_to_sheet([[document.title], [section.title], section.columns, ...section.rows])
    sheet['!cols'] = section.columns.map(() => ({ wch: 28 }))
    XLSX.utils.book_append_sheet(book, sheet, `${index + 1}-${section.title}`.slice(0, 31))
  })
  return { data: XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer, defaultName: `${document.title}-${document.id}.xlsx`.replace(/[<>:"/\\|?*]/g, '-'), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
