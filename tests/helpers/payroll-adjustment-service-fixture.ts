import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import { createPayrollC2ServiceFixture } from './payroll-c2-service-fixture'

export async function createPayrollAdjustmentFixture() {
  const f = await createPayrollC2ServiceFixture()
  await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 1000, ruleText: '' } }))
  await f.daywork({ status: 'confirmed', witness: '现场证明', confirmedOn: '2026-08-02' })
  const saved = await f.service.executeC2(f.c2Command(await f.c2Form(), { kind: 'save-c2-draft', draft: f.draft }))
  const statementId = saved.statementId!
  const original = () => f.service.c2Form({ origin: 'real' }, { statementId })
  await f.service.executeC2(f.c2Command(await original(), { kind: 'check-c2' }))
  await f.service.executeC2(f.c2Command(await original(), { kind: 'release-c2', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } }))
  let sequence = 0
  const adjustmentCommand = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `adjustment-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: read.original.projectId, target: read.target, action })
  async function correct(unitRate = 900) {
    const target = { adjustmentId: null, draftKey: `correction-${++sequence}`, originalStatementId: statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('应取得原 C2 依据')
    const draft = { ...initial.draft, reason: '原负责人单价记录错误', evidenceNote: '经办人与负责人核对原配置及签工', basis: { ...initial.draft.basis, unitRate } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    const saved = await f.service.executeAdjustment(adjustmentCommand(preview, { kind: 'save-adjustment-draft', draft }))
    const read = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: saved.adjustmentId! } })
    await f.service.executeAdjustment(adjustmentCommand(read, { kind: 'confirm-adjustment' }))
    return f.service.adjustmentDetail({ origin: 'real' }, saved.adjustmentId!)
  }
  async function paymentCommand(adjustmentId: string, amount: number) {
    const target = { kind: 'actual-payment' as const, draftKey: `refund-${++sequence}`, adjustmentIds: [adjustmentId] }
    const initial = await f.service.actualPaymentForm({ origin: 'real' }, { target })
    const draft = { kind: amount < 0 ? 'refund' as const : 'supplement' as const, occurredOn: '2026-08-05', amount, evidenceNote: '负责人已实际收退款，经办人核对', allocations: [{ workerId: 'w', amount }], applications: [{ adjustmentId, amount, balanceVersion: initial.balances[0]!.balanceVersion }] }
    const preview = await f.service.actualPaymentForm({ origin: 'real' }, { target, draft })
    return { commandId: `actual-${++sequence}`, workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: preview.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-actual-payment' as const, payment: draft } }
  }
  const refundCommand = (adjustmentId: string, amount: number) => paymentCommand(adjustmentId, -amount)
  const refund = async (adjustmentId: string, amount: number) => f.service.executeAdjustment(await refundCommand(adjustmentId, amount))
  return { ...f, statementId, adjustmentCommand, correct, refund, refundCommand, paymentCommand }
}
