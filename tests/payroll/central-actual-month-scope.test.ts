import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { decodePayrollAdjustmentRead } from '~/lib/payroll/central-adjustment-read-codec'
import { encodePayrollAdjustmentWire } from '~/lib/payroll/central-adjustment-wire'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

it.each([
  { label: '单人退款', rate: 900, august: -40, september: -110, allocations: [{ workerId: 'w', amount: -150 }], augustNet: 960, septemberNet: 1890, total: 2850, completeAllocation: true },
  { label: '多人退款', rate: 900, august: -40, september: -110, allocations: [{ workerId: 'w', amount: -50 }, { workerId: 'member', amount: -100 }], augustNet: 960, septemberNet: 1890, total: 2850, completeAllocation: false },
  { label: '单人补发', rate: 1100, august: 40, september: 110, allocations: [{ workerId: 'w', amount: 150 }], augustNet: 1040, septemberNet: 2110, total: 3150, completeAllocation: true },
])('跨两个月的$label按原更正处理金额计入各月，全周期只计一次', async (example) => {
  const f = await createPayrollAdjustmentFixture()
  try {
    const august = await f.correct(example.rate)
    await f.daywork({ workDate: '2026-09-01', status: 'confirmed', witness: '现场证明', confirmedOn: '2026-09-02' })
    await f.daywork({ workDate: '2026-09-02', status: 'confirmed', witness: '现场证明', confirmedOn: '2026-09-02' })
    const septemberDraft = { ...f.draft, month: '2026-09' }
    const saved = await f.service.executeC2(f.c2Command(await f.c2Form(septemberDraft, 'september'), { kind: 'save-c2-draft', draft: septemberDraft }))
    const septemberId = saved.statementId!
    const septemberForm = () => f.service.c2Form({ origin: 'real' }, { statementId: septemberId })
    await f.service.executeC2(f.c2Command(await septemberForm(), { kind: 'check-c2' }))
    await f.service.executeC2(f.c2Command(await septemberForm(), { kind: 'release-c2', release: { actualAmount: 2000, allocations: [{ workerId: 'w', amount: 2000 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } }))
    const target = { adjustmentId: null, draftKey: 'september-correction', originalStatementId: septemberId } as const
    const original = await f.service.adjustmentForm({ origin: 'real' }, { target })
    if (original.draft.basis?.formatFamily !== 'C2')
      throw new Error('应取得九月 C2 冻结依据')
    const correction = { ...original.draft, reason: '纠正九月单价', evidenceNote: '核对原签工与约定单价', basis: { ...original.draft.basis, unitRate: example.rate } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft: correction })
    const adjustment = await f.service.executeAdjustment(f.adjustmentCommand(preview, { kind: 'save-adjustment-draft', draft: correction }))
    const toConfirm = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: adjustment.adjustmentId! } })
    await f.service.executeAdjustment(f.adjustmentCommand(toConfirm, { kind: 'confirm-adjustment' }))

    const paymentTarget = { kind: 'actual-payment', draftKey: 'combined-refund', adjustmentIds: [august.adjustment.id, adjustment.adjustmentId!] } as const
    const payment = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget })
    const draft = {
      kind: example.rate < 1000 ? 'refund' as const : 'supplement' as const,
      occurredOn: '2026-09-05',
      amount: example.august + example.september,
      evidenceNote: '一次实际补退150元，其中八月40元、九月110元，方向按实际凭据核对',
      allocations: example.allocations,
      applications: payment.balances.map(balance => ({ adjustmentId: balance.adjustmentId, amount: balance.adjustmentId === august.adjustment.id ? example.august : example.september, balanceVersion: balance.balanceVersion })),
    }
    const checked = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget, draft })
    expect(checked.eligibility).toMatchObject({ canConfirmActual: true })
    const result = await f.service.executeAdjustment({ commandId: 'combined-refund-confirm', workspaceId: checked.context.workspaceId, actorId: checked.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: checked.context.sourceVersion, projectId: 'p', target: paymentTarget, action: { kind: 'confirm-actual-payment', payment: draft } })

    const augustLedger = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p', originalStatementIds: [f.statementId] })
    const septemberLedger = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p', originalStatementIds: [septemberId] })
    const whole = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
    expect(augustLedger.netAmount).toMatchObject({ state: 'known', value: example.augustNet })
    expect(septemberLedger.netAmount).toMatchObject({ state: 'known', value: example.septemberNet })
    expect(whole.netAmount).toMatchObject({ state: 'known', value: example.total })
    const scoped = augustLedger.rows.find(row => row.ref.kind === 'actual-event')!
    expect(scoped).toMatchObject({ qualification: 'scoped-amount-proven', signedAmount: { value: example.august }, originalStatementIds: [f.statementId], allocationState: example.completeAllocation ? 'complete' : 'partial' })
    expect(scoped.allocations.map(row => row.amount)).toEqual(example.completeAllocation ? [example.august] : [null, null])
    expect(() => decodePayrollAdjustmentRead(encodePayrollAdjustmentWire(augustLedger), 'actual-ledger', { origin: 'real' }, augustLedger.scope)).not.toThrow()
    expect((await f.service.actualPaymentDetail({ origin: 'real' }, result.actualEventId!)).fact.signedAmount.value).toBe(example.august + example.september)

    async function reverse(eventId: string, key: string) {
      const target = { kind: 'recording-reversal' as const, draftKey: key, original: { kind: 'actual-event' as const, eventId } }
      const draft = { confirmedNotOccurred: true, confirmedOn: '2026-09-06', evidenceNote: '核查这次记录不代表真实收付款，保留原记录追加更正' }
      const read = await f.service.actualReversalForm({ origin: 'real' }, { target, draft })
      expect(read.eligibility.canConfirmReversal).toBe(true)
      return f.service.executeAdjustment({ commandId: key, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-recording-reversal', reversal: draft } })
    }
    const reversed = await reverse(result.actualEventId!, 'first-reversal')
    expect((await f.service.actualLedger({ origin: 'real' }, augustLedger.scope)).netAmount.value).toBe(1000)
    expect((await f.service.actualLedger({ origin: 'real' }, septemberLedger.scope)).netAmount.value).toBe(2000)
    await reverse(reversed.actualEventId!, 'second-reversal')
    expect((await f.service.actualLedger({ origin: 'real' }, augustLedger.scope)).netAmount.value).toBe(example.augustNet)
    expect((await f.service.actualLedger({ origin: 'real' }, septemberLedger.scope)).netAmount.value).toBe(example.septemberNet)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(example.total)

    // 将包含两个月、真实收付和两层错记冲销的原库完整迁入；迁后身份改变也应保持范围金额。
    const source = await readQuantityCoreSource(f.db)
    const bytes = f.db.raw.export()
    const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
    const session = resolveBusinessSession()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('scope-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('scope-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: new Date().toISOString(), immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('scope-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('scope-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(m => m.entityType === 'projects' && m.legacyId === 'p')!.serverId
    const [evidence] = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select<{ mapping_json: string }>('SELECT mapping_json FROM payroll_migration_evidence WHERE project_id=?', [projectId]))
    const mappings: Array<{ tableName: string, legacyId: string, centralId: string | null }> = JSON.parse(evidence!.mapping_json)
    const migratedId = (table: string, id: string) => mappings.find(m => m.tableName === table && m.legacyId === id)!.centralId!
    for (const [originalId, net] of [[f.statementId, example.augustNet], [septemberId, example.septemberNet]] as const) {
      const originalStatementIds = [migratedId('wage_statements', originalId)]
      const ledger = await payrollService.actualLedger({ origin: 'real' }, { projectId, originalStatementIds })
      expect(ledger.netAmount).toMatchObject({ state: 'known', value: net })
      expect(ledger.rows.every(row => row.originalStatementIds.every(id => originalStatementIds.includes(id)))).toBe(true)
      expect(ledger.rows.filter(row => row.ref.kind === 'actual-event').map(row => row.qualification)).toEqual(['scoped-amount-proven', 'scoped-amount-proven', 'scoped-amount-proven'])
      expect(() => decodePayrollAdjustmentRead(encodePayrollAdjustmentWire(ledger), 'actual-ledger', { origin: 'real' }, ledger.scope)).not.toThrow()
    }
    expect((await payrollService.actualLedger({ origin: 'real' }, { projectId })).netAmount.value).toBe(example.total)
    expect((await payrollService.actualPaymentDetail({ origin: 'real' }, migratedId('payroll_actual_events', result.actualEventId!))).fact.signedAmount.value).toBe(example.august + example.september)
  }
  finally { await f.close() }
}, 30_000)
