import { afterEach, expect, it } from 'vitest'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAdjustmentMigrationFixture } from '../helpers/payroll-adjustment-migration-fixture'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

it('迁入完整原工资、更正及退款后继续处理剩余60，原始JSON和签收1000不变', async () => {
  const f = await createPayrollAdjustmentMigrationFixture()
  const query = { origin: 'real' as const, projectId: f.projectId }
  const originalRows = await f.instance.withWorkspaceTransaction(tx => tx.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [f.statementId]))
  const ledger = await f.service.actualLedger(query, { projectId: f.projectId })
  expect(ledger.status).toBe('complete')
  expect(ledger.netAmount.value).toBe(960)
  expect(ledger.rows.map(row => row.identity).sort()).toEqual([`real:payroll:released:${f.statementId}`, `real:payroll:actual:${f.eventId}`].sort())
  const detail = await f.service.adjustmentDetail(query, f.adjustmentId)
  expect(detail.balance.remainingDelta.value).toBe(-60)
  expect(detail.adjustment.snapshot?.original.originalSignatureAmount.value).toBe(1000)
  const target = { kind: 'actual-payment' as const, draftKey: 'migrated-refund-rest', adjustmentIds: [f.adjustmentId] }
  const initial = await f.service.actualPaymentForm(query, { target })
  const draft = { kind: 'refund' as const, occurredOn: '2026-08-08', amount: -60, evidenceNote: '迁入后核对退款到账', allocations: [{ workerId: f.workerId, amount: -60 }], applications: [{ adjustmentId: f.adjustmentId, amount: -60, balanceVersion: initial.balances[0]!.balanceVersion }] }
  const preview = await f.service.actualPaymentForm(query, { target, draft })
  expect(preview.eligibility).toEqual({ canConfirmActual: true, reasons: [] })
  const result = await f.service.executeAdjustment({ commandId: 'migrated-refund-rest', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: preview.context.sourceVersion, projectId: f.projectId, target, action: { kind: 'confirm-actual-payment', payment: draft } })
  expect((await f.service.actualPaymentDetail(query, result.actualEventId!)).fact.signedAmount.value).toBe(-60)
  expect((await f.service.actualLedger(query, { projectId: f.projectId })).netAmount.value).toBe(900)
  expect((await f.service.adjustmentDetail(query, f.adjustmentId)).balance.remainingDelta.value).toBe(0)
  expect(await f.instance.withWorkspaceTransaction(tx => tx.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [f.statementId]))).toEqual(originalRows)
  const imported = await f.service.actualPaymentDetail(query, f.eventId)
  expect(imported.snapshot.id).toBe(f.eventId)
  expect(imported.snapshot.originals[0]!.statementId).toBe(f.statementId)
})

it('迁入退款可以独立错记冲销并恢复剩余，冷读仍保留原退款及原签收', async () => {
  const f = await createPayrollAdjustmentMigrationFixture()
  const query = { origin: 'real' as const, projectId: f.projectId }
  const target = { kind: 'recording-reversal' as const, draftKey: 'reverse-imported', original: { kind: 'actual-event' as const, eventId: f.eventId } }
  const draft = { confirmedNotOccurred: true, confirmedOn: '2026-08-09', evidenceNote: '核查确认原40元退款记录未真实发生' }
  const read = await f.service.actualReversalForm(query, { target, draft })
  expect(read.eligibility.canConfirmReversal).toBe(true)
  const command = { commandId: 'reverse-imported', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId: f.projectId, target, action: { kind: 'confirm-recording-reversal' as const, reversal: draft } }
  const result = await f.service.executeAdjustment(command)
  expect(await f.service.executeAdjustment(command)).toEqual(result)
  expect((await f.service.actualLedger(query, { projectId: f.projectId })).netAmount.value).toBe(1000)
  expect((await f.service.actualPaymentDetail(query, f.eventId)).fact.kind).toBe('refund')
  expect((await f.service.adjustmentDetail(query, f.adjustmentId)).balance.remainingDelta.value).toBe(-100)
})

it('已缓存迁入源证明后物理应用被删除，不能把原已退40重新当作可退余额', async () => {
  const f = await createPayrollAdjustmentMigrationFixture()
  const query = { origin: 'real' as const, projectId: f.projectId }
  expect((await f.service.adjustmentDetail(query, f.adjustmentId)).balance.remainingDelta.value).toBe(-60)
  await f.instance.withWorkspaceTransaction(tx => tx.execute('DELETE FROM payroll_adjustment_applications WHERE actual_event_id=?', [f.eventId]))
  await expect(f.service.actualLedger(query, { projectId: f.projectId })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  await expect(f.service.adjustmentDetail(query, f.adjustmentId)).rejects.toMatchObject({ problem: { code: 'unavailable' } })
})

it('迁入确认后可追加有原引用的续更正，按前次900核到950并保原单1000', async () => {
  const f = await createPayrollAdjustmentMigrationFixture()
  const query = { origin: 'real' as const, projectId: f.projectId }
  const target = { adjustmentId: null, draftKey: 'imported-followup', originalStatementId: f.statementId } as const
  const initial = await f.service.adjustmentForm(query, { target })
  if (initial.draft.basis?.formatFamily !== 'C2')
    throw new Error('须保留 C2 原依据')
  const draft = { ...initial.draft, correctsAdjustmentId: f.adjustmentId, reason: '再核对原单价', evidenceNote: '更正后的900应为950', basis: { ...initial.draft.basis, unitRate: 950 } }
  const preview = await f.service.adjustmentForm(query, { target, draft })
  expect(preview.preview.beforeAmount.value).toBe(900)
  expect(preview.preview.delta.value).toBe(50)
  const command = { commandId: 'imported-followup-save', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: preview.context.sourceVersion, projectId: f.projectId, target, action: { kind: 'save-adjustment-draft' as const, draft } }
  const saved = await f.service.executeAdjustment(command)
  const read = await f.service.adjustmentForm(query, { target: { adjustmentId: saved.adjustmentId! } })
  await f.service.executeAdjustment({ ...command, commandId: 'imported-followup-confirm', target: read.target, sourceVersion: read.context.sourceVersion, action: { kind: 'confirm-adjustment' } })
  const detail = await f.service.adjustmentDetail(query, saved.adjustmentId!)
  expect(detail.original.originalSignatureAmount.value).toBe(1000)
  expect(detail.balance).toMatchObject({ confirmedDelta: { value: -50 }, appliedDelta: { value: -40 }, remainingDelta: { value: -10 } })
})
