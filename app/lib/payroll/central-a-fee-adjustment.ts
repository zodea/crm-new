import type { PayrollAFeeAdjustmentBasis, PayrollAStatementSourceSnapshotV2, PayrollAStatementSourceSnapshotV4 } from './central-a-fees-contract'
import type { PayrollAStatementSourceSnapshotV3 } from './central-a-hollow-contract'
import type { PayrollAAdjustmentBasis } from './central-adjustment-contract'
import { payrollAAmount } from './central-a-calculation'
import { isPayrollABook, isPayrollANegativeValues } from './central-a-fees-validation'
import { payrollCanonical } from './central-command-shared'
import { payrollProblem } from './central-contract'
import { wireCent, wireExact, wireId, wireNullableNumber, wireText } from './central-payroll-wire'
import { amountInCents, rounded } from './statements'

/** 从已证原冻结取可改的量价，来源只保留在上层 source 一份。 */
export function payrollAFeeAdjustmentBasis(source: PayrollAStatementSourceSnapshotV2 | PayrollAStatementSourceSnapshotV3 | PayrollAStatementSourceSnapshotV4): PayrollAFeeAdjustmentBasis {
  return { schemaVersion: 1, book: source.book, components: source.fees.lines.flatMap(line => line.components.map(c => ({ componentKey: c.componentKey, feeId: c.feeId, feeRevisionId: c.feeRevisionId, ownershipKey: c.ownershipKey, quantity: c.quantity, unitPrice: c.unitPrice }))), negativeLines: source.fees.negativeLines.filter(n => !n.removed).map(n => ({ lineId: n.lineId, originalNegativeRevisionId: n.id, label: n.label, quantity: n.quantity, unit: n.unit, unitPrice: n.unitPrice, scope: n.scope, reason: n.reason, evidenceNote: n.evidenceNote, actualRef: n.actualRef })) }
}

export function assertPayrollAFeeAdjustmentBasis(value: unknown): asserts value is PayrollAFeeAdjustmentBasis {
  const fail = () => {
    throw payrollProblem('validation-failed', '费用更正须保留原簿、费项和逐份原责任或负价依据')
  }
  wireExact(value, ['schemaVersion', 'book', 'components', 'negativeLines'])
  if (value.schemaVersion !== 1 || !isPayrollABook(value.book) || !Array.isArray(value.components) || !Array.isArray(value.negativeLines))
    fail()
  for (const c of value.components as unknown[]) {
    wireExact(c, ['componentKey', 'feeId', 'feeRevisionId', 'ownershipKey', 'quantity', 'unitPrice'])
    if (!wireText(c.componentKey) || !c.componentKey || !wireText(c.ownershipKey) || !c.ownershipKey || !wireId(c.feeId) || !wireId(c.feeRevisionId) || !wireNullableNumber(c.quantity) || !wireNullableNumber(c.unitPrice))
      fail()
  }
  for (const n of value.negativeLines as unknown[]) {
    wireExact(n, ['lineId', 'originalNegativeRevisionId', 'label', 'quantity', 'unit', 'unitPrice', 'scope', 'reason', 'evidenceNote', 'actualRef'])
    if (!wireId(n.lineId) || !wireId(n.originalNegativeRevisionId) || !isPayrollANegativeValues(n))
      fail()
  }
}

export function payrollAFeeCorrectionReasons(basis: PayrollAAdjustmentBasis, original: PayrollAAdjustmentBasis): string[] {
  if (original.source.schemaVersion === 1)
    return basis.fees === undefined ? [] : ['旧 A 来源不能借独立更正补造费用或管理用途']
  const fees = basis.fees
  const before = original.fees
  if (!fees || !before || payrollCanonical(fees.book) !== payrollCanonical(before.book) || payrollCanonical(fees.book) !== payrollCanonical(original.source.book))
    return ['费用更正不能更换原普通簿或原管理簿']
  const reasons: string[] = []
  if (fees.components.length !== before.components.length || new Set(fees.components.map(c => c.componentKey)).size !== before.components.length)
    reasons.push('费用更正须保留完整、不重复的原费项责任集合')
  for (const c of fees.components) {
    const old = before.components.find(o => o.componentKey === c.componentKey)
    if (!old || old.feeId !== c.feeId || old.feeRevisionId !== c.feeRevisionId || old.ownershipKey !== c.ownershipKey)
      reasons.push('费用更正不能替换原费项、修订或施工责任')
    if (c.quantity === null || c.quantity < 0 || c.unitPrice === null || !wireCent(c.unitPrice))
      reasons.push('正向费用更正须明确非负现场量及到分单价')
  }
  if (fees.negativeLines.length !== before.negativeLines.length || new Set(fees.negativeLines.map(n => n.lineId)).size !== before.negativeLines.length)
    reasons.push('管理负价更正须保留完整且不重复的原清单行')
  if (fees.book.bookPurpose !== 'management' && fees.negativeLines.length)
    reasons.push('普通工资及补贴不能使用管理负价清单')
  for (const n of fees.negativeLines) {
    const old = before.negativeLines.find(o => o.lineId === n.lineId)
    if (!old || n.originalNegativeRevisionId !== old.originalNegativeRevisionId || n.unit !== old.unit || payrollCanonical(n.scope) !== payrollCanonical(old.scope) || payrollCanonical(n.actualRef) !== payrollCanonical(old.actualRef))
      reasons.push('管理负价更正不能移动原范围、单位或冒用另一实付依据')
    if (n.quantity === null || n.quantity < 0 || n.unitPrice === null || n.unitPrice >= 0 || !wireCent(Math.abs(n.unitPrice)) || !n.unit?.trim() || !n.label.trim() || !n.reason.trim() || !n.evidenceNote.trim())
      reasons.push('请完整核对负价行的数量、负单价、原范围、原因与依据')
  }
  return [...new Set(reasons)]
}

/** 与 A 原核算一致：同费项/楼栋/分项/单位/价修订先合量，再结算到分。 */
export function payrollAFeeCorrectionLines(basis: PayrollAAdjustmentBasis) {
  if (basis.source.schemaVersion === 1)
    return basis.fees === undefined ? { positive: [], negative: [] } : null
  if (!basis.fees || payrollCanonical(basis.fees.book) !== payrollCanonical(basis.source.book))
    return null
  const sourceComponents = basis.source.fees.lines.flatMap(l => l.components)
  const groups = new Map<string, { feeId: string, quantity: number | null, unitPrice: number | null }>()
  for (const c of basis.fees.components) {
    const original = sourceComponents.find(o => o.componentKey === c.componentKey && o.feeId === c.feeId && o.feeRevisionId === c.feeRevisionId && o.ownershipKey === c.ownershipKey)
    if (!original)
      return null
    const key = payrollCanonical([c.feeId, original.fact.buildingId, original.fact.itemId, original.fact.unit, c.feeRevisionId, c.unitPrice])
    const old = groups.get(key)
    groups.set(key, { feeId: c.feeId, quantity: c.quantity === null || old?.quantity === null ? null : c.quantity + (old?.quantity ?? 0), unitPrice: c.unitPrice })
  }
  const positive = [...groups.values()].map(g => ({ feeId: g.feeId, amount: payrollAAmount([g.quantity === null || g.unitPrice === null ? null : rounded(g.quantity * g.unitPrice)]) }))
  const negative = basis.fees.negativeLines.map(n => ({ lineId: n.lineId, signedAmountFen: n.quantity === null || n.unitPrice === null ? null : amountInCents(rounded(n.quantity * n.unitPrice)) }))
  return { positive, negative }
}

export function payrollAFeeCorrectionAmount(basis: PayrollAAdjustmentBasis, reasons: string[] = []) {
  const lines = payrollAFeeCorrectionLines(basis)
  if (!lines)
    return payrollAAmount([null], [...reasons, '费用更正缺少同簿或原责任依据'])
  return payrollAAmount([...lines.positive.map(line => line.amount.value), ...lines.negative.map(line => line.signedAmountFen === null ? null : line.signedAmountFen / 100)], reasons)
}
