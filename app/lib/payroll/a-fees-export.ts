import type { PayrollAFeesFrozenDocument } from './central-a-fees-contract'
import * as XLSX from 'xlsx'

/** 仅展开已证明的冻结组成，供单张输出及后续完整工作簿组合。 */
export function appendPayrollAFeesSheets(workbook: XLSX.WorkBook, document: PayrollAFeesFrozenDocument) {
  const fees = document.fees
  const sheets = [
    { name: '费用组成', rows: fees.lines.map(line => ({ 费用身份: line.feeId, 类别: { housing: '房补', subsidy: '补贴', management: '管理费' }[line.kind], 名称: line.name, 楼栋: line.buildingName, 分项: line.itemName, 单位: line.unit, 完成量: line.quantity, 金额: line.amount.value, 已知金额: line.amount.knownValue, 完整度: line.amount.state, 费率修订: line.feeRevisionIds.join('、') })) },
    { name: '费用原量依据', rows: fees.lines.flatMap(line => line.components.map(component => ({ 费用: line.name, 原组成身份: component.componentKey, 费用修订: component.feeRevisionId, 原工人: component.fact.workerName, 原班组: component.fact.crewName, 楼栋: component.fact.buildingName, 楼层: component.fact.floorName, 户: component.fact.unitName, 房间: component.fact.roomName, 分项: component.fact.itemName, 单位: component.fact.unit, 完成现场量: component.quantity, 费用单价: component.unitPrice, 金额: component.amountFen === null ? null : component.amountFen / 100, 原责任身份: component.fact.assignmentId, 原完成身份: component.fact.completionId, 原来源身份: component.ownershipKey }))) },
    { name: '负价代付清单', rows: fees.negativeLines.filter(line => !line.removed).map(line => ({ 清单身份: line.lineId, 原修订: line.id, 名称: line.label, 数量: line.quantity, 单位: line.unit, 负单价: line.unitPrice, 有符号金额: line.signedAmountFen === null ? null : line.signedAmountFen / 100, 事由: line.reason, 确认依据: line.evidenceNote, 管理簿: line.managementBookId, 管理修订: line.managementRevisionId, 原责任范围: JSON.stringify(line.scope), 真实收付引用: line.actualRef ? JSON.stringify(line.actualRef) : '未关联实际收付' })) },
    { name: '本簿此前实际已领', rows: document.previousBookPayments.map(payment => ({ 工资单身份: payment.statementId, 月份: payment.month, 实际已领: payment.amount, 用途: payment.book.bookPurpose === 'management' ? '管理费' : '普通施工工资', 管理簿: payment.book.managementBookId })) },
    { name: '费用冻结汇总', rows: [{ 请款用途: document.book.bookPurpose === 'management' ? '管理费进度款' : '普通施工工资', 管理簿: document.book.managementBookId, 管理依据: fees.management?.revision.evidenceNote ?? null, 工作金额: fees.totals.workAmount.value, 补贴金额: fees.totals.subsidyAmount.value, 管理费金额: fees.totals.managementAmount.value, 负价金额: fees.totals.negativeAmount.value, 清单合计: document.listAmount, [document.ratioPlan ? '费用默认比例' : '支付比例']: document.payRatio, 累计应付: document.cumulativeAmount, 本簿此前实际已领: document.previouslyPaid, 本次核算应发: document.grossAmount, 本次实发: document.actualAmount }] },
  ]
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet.rows), sheet.name)
}
