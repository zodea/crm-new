import type { PayrollAFeeQuantityComponent, PayrollAStatementSourceSnapshotV2 } from '~/lib/payroll/central-a-fees-contract'
import type { PayrollAAdjustmentBasis } from '~/lib/payroll/central-adjustment-contract'
import { describe, expect, it } from 'vitest'
import { payrollCorrectionAmount } from '~/lib/payroll/central-adjustment-calculation'
import { payrollCorrectionReasons } from '~/lib/payroll/central-adjustment-validation'
import { payrollAFact } from '../helpers/payroll-a-service-fixture'

/** 只验证独立更正的运算；不冒充已发冻结或服务证明。 */
function basis(management = false): PayrollAAdjustmentBasis {
  const fact = payrollAFact({ fieldQty: 100 })
  const component: PayrollAFeeQuantityComponent = { componentKey: 'fee:original', feeId: 'fee', feeRevisionId: 'fee-r1', ownershipKey: fact.ownershipKey, managementOwnership: null, fact, quantity: 100, unitPrice: management ? 15 : 1.3, amountFen: management ? 150000 : 13000 }
  const amount = { value: 0, knownValue: 0, state: 'known' as const, reasons: [] }
  const book = management ? { bookPurpose: 'management' as const, managementBookId: 'book' } : { bookPurpose: 'ordinary' as const, managementBookId: null }
  const source: PayrollAStatementSourceSnapshotV2 = { schemaVersion: 2, book, subject: { projectId: 'p', crewId: 'crew', leaderWorkerId: 'w' }, facts: [fact], priceRevisions: [], fees: { schemaVersion: 1, configSourceVersion: 'fees-v1', crewDefaults: null, feeRevisions: [], management: null, managementOwnership: [], negativeLines: [], lines: [{ id: 'fee-line', kind: management ? 'management' : 'housing', feeId: 'fee', feeRevisionIds: ['fee-r1'], name: '原费用', buildingId: fact.buildingId, buildingName: fact.buildingName, itemId: fact.itemId, itemName: fact.itemName, unit: fact.unit, quantity: 100, knownQuantity: 100, amount, components: [component], sources: [], blockers: [] }], totals: { workAmount: amount, subsidyAmount: amount, managementAmount: amount, negativeAmount: amount, listAmount: amount, cumulativeAmount: amount, previouslyPaid: amount, grossAmount: amount } } }
  return { formatFamily: 'A', periodKind: 'monthly', source, payRatio: management ? 0.8 : 1, components: management ? [] : [{ ownershipKey: fact.ownershipKey, priceRevisionId: 'price-r1', quantity: 100, unitPrice: 36 }], fees: { schemaVersion: 1, book, components: [{ componentKey: component.componentKey, feeId: component.feeId, feeRevisionId: component.feeRevisionId, ownershipKey: component.ownershipKey, quantity: component.quantity, unitPrice: component.unitPrice }], negativeLines: [] } }
}

describe('a 费用独立更正计算', () => {
  it.each([
    { quantity: 100, payRatio: 1, expected: 3730 },
    { quantity: 90, payRatio: 1, expected: 3717 },
    { quantity: 90, payRatio: 0.8, expected: 2973.6 },
  ])('普通工资与独立住房补贴按数量 $quantity、比例 $payRatio 核算 $expected', ({ quantity, payRatio, expected }) => {
    const draft = basis()
    draft.fees!.components[0]!.quantity = quantity
    draft.payRatio = payRatio
    expect(payrollCorrectionAmount(draft).value).toBe(expected)
  })

  it.each([
    { quantity: 30, expected: 720 },
    { quantity: 20, expected: 880 },
  ])('1500管理清单加 $quantity 套×-20后乘80%=$expected，负价不二次扣除', ({ quantity, expected }) => {
    const draft = basis(true)
    draft.fees!.negativeLines.push({ lineId: 'negative', originalNegativeRevisionId: 'negative-r1', label: '未收尾代付', quantity, unit: '套', unitPrice: -20, scope: { assignments: [{ assignmentId: 'assignment', scopeIds: ['scope'], cells: [{ unitId: 'u', roomId: 'r', itemId: 'item' }] }] }, reason: '明确未收尾范围', evidenceNote: '负责人复核记录', actualRef: null })
    expect(payrollCorrectionAmount(draft).value).toBe(expected)
  })

  it('同费用同楼栋同分项同价先汇总数量，两个0.005只结算0.01', () => {
    const draft = basis()
    draft.components = []
    const first = draft.source.schemaVersion === 2 && draft.source.fees.lines[0]!
    if (!first)
      throw new Error('需要费用行')
    first.components[0]!.quantity = 0.5
    first.components[0]!.unitPrice = 0.01
    first.components.push({ ...structuredClone(first.components[0]!), componentKey: 'fee:second', ownershipKey: 'second', fact: payrollAFact({ ownershipKey: 'second', fieldQty: 0.5 }) })
    draft.fees!.components = first.components.map(c => ({ componentKey: c.componentKey, feeId: c.feeId, feeRevisionId: c.feeRevisionId, ownershipKey: c.ownershipKey, quantity: c.quantity, unitPrice: c.unitPrice }))
    expect(payrollCorrectionAmount(draft).value).toBe(0.01)
  })

  it.each([
    { case: 'v2缺费用', change: (draft: PayrollAAdjustmentBasis) => Reflect.deleteProperty(draft, 'fees') },
    { case: '费用量未知', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.components[0]!.quantity = null } },
  ])('$case 不能降级成只算普通工资或已知量', ({ change }) => {
    const draft = basis()
    change(draft)
    expect(payrollCorrectionAmount(draft).value).toBeNull()
  })

  it.each([
    { case: '替换费项', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.components[0]!.feeId = 'other-fee' } },
    { case: '移除费项', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.components = [] } },
    { case: '更换账簿', change: (draft: PayrollAAdjustmentBasis) => { draft.fees!.book = { bookPurpose: 'management', managementBookId: 'other-book' } } },
  ])('更正不能借 $case 转移原来源', ({ change }) => {
    const original = basis()
    const draft = structuredClone(original)
    change(draft)
    expect(payrollCorrectionReasons(draft, original).length).toBeGreaterThan(0)
  })
})
