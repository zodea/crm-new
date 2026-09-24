import type { PayrollAAmount } from './central-a-contract'
import type { PayrollHollowAdjustmentBasis, PayrollHollowSnapshot } from './central-hollow-deduction-contract'
import { isQuantitySourceIdentity } from '../quantity/migration-identity'
import { payrollAAmount, payrollAMoney } from './central-a-calculation'
import { payrollCanonical } from './central-command-shared'
import { isPayrollHollowSnapshot } from './central-hollow-deduction-snapshot'
import { hollowDeductionExact, hollowDeductionFail } from './central-hollow-deduction-validation'
import { wireNullableNumber } from './central-payroll-wire'
import { isPayrollSourceIdentity } from './migration-identity'

export function payrollHollowAdjustmentBasis(source: PayrollHollowSnapshot): PayrollHollowAdjustmentBasis {
  return { schemaVersion: 1, source: structuredClone(source), components: source.adoptions.map(adoption => ({ adoptionId: adoption.id, recordId: adoption.line.recordId, count: adoption.line.count, unitAmount: adoption.line.unitAmount })) }
}
export function assertPayrollHollowAdjustmentBasis(v: unknown): asserts v is PayrollHollowAdjustmentBasis {
  hollowDeductionExact(v, ['schemaVersion', 'source', 'components'])
  if (v.schemaVersion !== 1 || !isPayrollHollowSnapshot(v.source) || v.source.state !== 'available' || !Array.isArray(v.components))
    hollowDeductionFail('独立更正必须保留原空鼓冻结来源及采用集合')
  for (const component of v.components) {
    hollowDeductionExact(component, ['adoptionId', 'recordId', 'count', 'unitAmount'])
    if (!isPayrollSourceIdentity(component.adoptionId, 'payroll_hollow_adoptions') || !isQuantitySourceIdentity(component.recordId, 'quantity_hollow_records') || !wireNullableNumber(component.count) || !wireNullableNumber(component.unitAmount))
      hollowDeductionFail('空鼓更正必须指向原采用身份，量价未知须保留空值')
  }
}
export function payrollHollowCorrectionReasons(after: PayrollHollowAdjustmentBasis | undefined, before: PayrollHollowAdjustmentBasis | undefined): string[] {
  if (!before)
    return after === undefined ? [] : ['原工资没有空鼓采用依据，不能通过更正补造扣款']
  if (!after || payrollCanonical(after.source) !== payrollCanonical(before.source))
    return ['空鼓更正必须保留原冻结检查、整改、单价及采用事实']
  const reasons: string[] = []
  if (after.components.length !== before.components.length || new Set(after.components.map(component => component.adoptionId)).size !== before.components.length)
    reasons.push('空鼓更正须保留完整且不重复的原采用集合')
  for (const component of after.components) {
    const original = before.components.find(value => value.adoptionId === component.adoptionId)
    if (!original || original.recordId !== component.recordId)
      reasons.push('空鼓更正不能转移到另一原记录或采用身份')
    if (component.count === null || !Number.isSafeInteger(component.count) || component.count < 0 || component.unitAmount === null || !Number.isFinite(component.unitAmount) || component.unitAmount < 0)
      reasons.push('请明确空鼓更正的非负整数处数和非负单处金额')
  }
  return [...new Set(reasons)]
}
export function payrollHollowCorrectionAmount(subtotal: PayrollAAmount, basis: PayrollHollowAdjustmentBasis | undefined): PayrollAAmount {
  if (!basis)
    return subtotal
  const deduction = payrollAAmount(basis.components.map(component => component.count === null || component.unitAmount === null ? null : payrollAMoney(component.count * component.unitAmount)))
  if (subtotal.value === null || deduction.value === null)
    return payrollAAmount([null], [...subtotal.reasons, ...deduction.reasons, '空鼓更正或原核算金额尚未完整核实'])
  if (deduction.value > subtotal.value)
    return payrollAAmount([null], ['空鼓更正超出原核算金额，部分处理规则尚待明确'])
  return payrollAAmount([payrollAMoney(subtotal.value - deduction.value)], subtotal.reasons)
}
