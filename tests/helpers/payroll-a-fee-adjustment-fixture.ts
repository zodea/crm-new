import type { PayrollAAdjustmentBasis, PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import { createPayrollAFeesFixture } from './payroll-a-fees-fixture'

/** 所有原单、更正及实际补退通过公开服务建立，供 P5 集成反例复用。 */
export async function createPayrollAFeeAdjustmentFixture() {
  const f = await createPayrollAFeesFixture()
  let sequence = 0
  const adjustmentCommand = (read: PayrollAdjustmentFormRead, action: PayrollAdjustmentAction) => ({ commandId: `fee-adjustment-${++sequence}`, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: 'p', target: read.target, action })
  async function correct(statementId: string, mutate: (basis: PayrollAAdjustmentBasis) => void) {
    const target = { adjustmentId: null, draftKey: `fee-correction-${++sequence}`, originalStatementId: statementId } as const
    const read = await f.service.adjustmentForm({ origin: 'real' }, { target })
    if (read.draft.basis?.formatFamily !== 'A' || !read.draft.basis.fees)
      throw new Error('缺少原 A V2 费用依据')
    const draft = structuredClone(read.draft)
    mutate(draft.basis as PayrollAAdjustmentBasis)
    draft.reason = '原费用明细核对需更正'
    draft.evidenceNote = '原负责人和经办人共同复核记录'
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    const saved = await f.service.executeAdjustment(adjustmentCommand(preview, { kind: 'save-adjustment-draft', draft }))
    const checked = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: saved.adjustmentId! } })
    await f.service.executeAdjustment(adjustmentCommand(checked, { kind: 'confirm-adjustment' }))
    return f.service.adjustmentDetail({ origin: 'real' }, saved.adjustmentId!)
  }
  async function pay(adjustmentId: string, amount: number) {
    const target = { kind: 'actual-payment' as const, draftKey: `fee-payment-${++sequence}`, adjustmentIds: [adjustmentId] }
    const read = await f.service.actualPaymentForm({ origin: 'real' }, { target })
    const payment = { kind: amount < 0 ? 'refund' as const : 'supplement' as const, occurredOn: '2026-08-20', amount, evidenceNote: '经办与收款人已核实真实收付', allocations: [{ workerId: 'w', amount }], applications: [{ adjustmentId, amount, balanceVersion: read.balances[0]!.balanceVersion }] }
    const preview = await f.service.actualPaymentForm({ origin: 'real' }, { target, draft: payment })
    return f.service.executeAdjustment({ commandId: `fee-actual-${++sequence}`, workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: preview.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-actual-payment', payment } })
  }
  async function ordinary() {
    await f.prices()
    await f.saveFees([f.fee()])
    const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
    const saved = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
    await f.release(saved.statementId!, 3730)
    return saved.statementId!
  }
  async function addNextWork() {
    await f.db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(\'fee-unit2\',\'fee-floor\',\'fee-template\',\'102\')')
    await f.db.execute('INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES(\'fee-assignment2\',\'fee-unit2\',\'泥工\',\'w\')')
    for (const itemId of ['wall', 'floor', 'shower'])
      await f.db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,?,?)', [`fee-scope2-${itemId}`, 'fee-assignment2', 'fee-room', itemId])
    await f.db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(\'fee-completion2\',\'fee-unit2\',\'fee-stage\',\'fee-assignment2\',\'completed\',\'2026-09-05\')')
  }
  return { ...f, correct, pay, ordinaryStatement: ordinary, addNextWork }
}
