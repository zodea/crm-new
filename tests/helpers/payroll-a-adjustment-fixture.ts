import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import { createPayrollAServiceFixture, payrollAFact } from './payroll-a-service-fixture'

export async function createPayrollAAdjustmentFixture() {
  const f = await createPayrollAServiceFixture()
  f.facts.rows[0]!.fieldQty = 10
  f.facts.rows[0]!.fieldFormula = '2*5'
  await f.config()
  await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
  await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 100, scope: { kind: 'project' } }] }))
  const draft = { ...f.draft, payRatio: 1 }
  const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
  const statementId = saved.statementId!
  const original = () => f.service.aForm({ origin: 'real' }, { statementId })
  await f.service.execute(f.command(await original(), { kind: 'check-a' }))
  await f.service.execute(f.command(await original(), { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'zero', amount: 0 }] } }))
  let sequence = 0
  const adjustmentCommand = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `a-adjustment-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
  async function correct(quantity = 9) {
    const target = { adjustmentId: null, draftKey: `a-correction-${++sequence}`, originalStatementId: statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'A')
      throw new Error('缺少 A 原责任依据')
    const draft = { ...initial.draft, reason: '原现场量记录需更正', evidenceNote: `负责人和经办人核对本户实际${quantity}平方米`, basis: { ...initial.draft.basis, components: initial.draft.basis.components.map(c => ({ ...c, quantity })) } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    const saved = await f.service.executeAdjustment(adjustmentCommand(preview, { kind: 'save-adjustment-draft', draft }))
    await f.service.executeAdjustment(adjustmentCommand(await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: saved.adjustmentId! } }), { kind: 'confirm-adjustment' }))
    return f.service.adjustmentDetail({ origin: 'real' }, saved.adjustmentId!)
  }
  async function refund(adjustmentId: string, amount: number) {
    const target = { kind: 'actual-payment' as const, draftKey: `a-refund-${++sequence}`, adjustmentIds: [adjustmentId] }
    const initial = await f.service.actualPaymentForm({ origin: 'real' }, { target })
    const payment = { kind: 'refund' as const, occurredOn: '2026-08-08', amount: -amount, evidenceNote: '负责人已实际退回且经办人核对', allocations: [{ workerId: 'w', amount: -amount }], applications: [{ adjustmentId, amount: -amount, balanceVersion: initial.balances[0]!.balanceVersion }] }
    const preview = await f.service.actualPaymentForm({ origin: 'real' }, { target, draft: payment })
    return f.service.executeAdjustment({ commandId: `a-refund-command-${++sequence}`, workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: preview.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-actual-payment', payment } })
  }
  const addNextWork = () => f.facts.rows.push(payrollAFact({ ownershipKey: 'p:u2:assignment2:r:item', completionId: 'completed2', assignmentId: 'assignment2', unitId: 'u2', fieldQty: 10, fieldFormula: '2*5', sourceFingerprint: 'cell2' }))
  return { ...f, statementId, correct, refund, addNextWork }
}
