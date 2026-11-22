import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { decodePayrollAdjustmentRead } from '~/lib/payroll/central-adjustment-read-codec'
import { encodePayrollAdjustmentWire } from '~/lib/payroll/central-adjustment-wire'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAdjustmentFixture } from '../helpers/payroll-adjustment-service-fixture'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'
import { seedReleasedPayrollMigrationSource } from '../helpers/payroll-migration-source'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

describe('工资实发', () => {
  it('核减100后实际退回40，只减少一次实际现金并保留60待处理和原签名', async () => {
    const f = await createPayrollAdjustmentFixture()
    try {
      const correction = await f.correct()
      const frozen = await f.service.c2Output({ origin: 'real' }, f.statementId)
      const target = { kind: 'actual-payment', draftKey: 'refund40', adjustmentIds: [correction.adjustment.id] } as const
      const initial = await f.service.actualPaymentForm({ origin: 'real' }, { target })
      expect(initial.draft.amount).toBeNull()
      const draft = { kind: 'refund' as const, occurredOn: '2026-08-05', amount: -40, evidenceNote: '负责人已实际退回40元，经办人当面核对', allocations: [{ workerId: 'w', amount: -40 }], applications: [{ adjustmentId: correction.adjustment.id, amount: -40, balanceVersion: initial.balances[0]!.balanceVersion }] }
      const preview = await f.service.actualPaymentForm({ origin: 'real' }, { target, draft })
      const command = { commandId: 'actual-refund40', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: preview.context.sourceVersion, projectId: 'p', target, action: { kind: 'confirm-actual-payment' as const, payment: draft } }
      const receipt = await f.service.executeAdjustment(command)
      const retry = await f.service.executeAdjustment(command)
      expect(retry).toEqual(receipt)
      const detail = await f.service.actualPaymentDetail({ origin: 'real' }, receipt.actualEventId!)
      expect(detail.fact).toMatchObject({ kind: 'refund', signedAmount: { value: -40 }, allocations: [{ workerId: 'w', amount: -40 }] })
      const balance = await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)
      expect(balance.balance).toMatchObject({ confirmedDelta: { value: -100 }, appliedDelta: { value: -40 }, remainingDelta: { value: -60 } })
      const ledger = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
      expect(ledger.netAmount.value).toBe(960)
      expect(ledger.rows.map(r => r.kind).sort()).toEqual(['initial-release', 'refund'])
      expect(await f.service.c2Output({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: frozen.document })
    }
    finally {
      await f.close()
    }
  }, 30_000)

  it('历史总额、个人分配与新写依据分别判断：缺个人分配仍保留可证300，不能均分或开放更正', async () => {
    const f = await createPayrollC1ServiceFixture()
    try {
      const old = await seedReleasedPayrollMigrationSource(f.db)
      const snapshot = JSON.parse(old.snapshot)
      delete snapshot.allocations
      snapshot.allocationRecorded = false
      await f.db.execute('UPDATE wage_statements SET snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), old.statementId])
      const read = await f.service.actualLedger({ origin: 'real' }, { projectId: 'pay-healthy-project' })
      expect(read.netAmount).toMatchObject({ value: 300, state: 'known' })
      expect(read.rows).toHaveLength(1)
      expect(read.rows[0]).toMatchObject({ kind: 'initial-release', qualification: 'historical-amount-proven', allocationState: 'unknown', allocations: [] })
      expect(read.rows[0]!.historicalMembers.map(m => m.name)).toContain('冻结时负责人')
      await expect(f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: null, draftKey: 'historical-correction', originalStatementId: old.statementId } })).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    }
    finally { await f.close() }
  })

  it('原快照缺失时实际额未知，不能取当前头300；明确原实发为0时保留真实零', async () => {
    const f = await createPayrollC1ServiceFixture()
    try {
      const old = await seedReleasedPayrollMigrationSource(f.db)
      await f.db.execute('UPDATE wage_statements SET snapshot_json=NULL WHERE id=?', [old.statementId])
      const unknown = await f.service.actualLedger({ origin: 'real' }, { projectId: 'pay-healthy-project' })
      expect(unknown.netAmount.value).toBeNull()
      expect(unknown.rows[0]).toMatchObject({ qualification: 'unproven', signedAmount: { value: null }, allocationState: 'unknown' })
      const snapshot = { ...JSON.parse(old.snapshot), actualAmount: 0, actualAmountFen: 0, allocationTotalFen: 0, allocations: [], allocationRecorded: false }
      await f.db.execute('UPDATE wage_statements SET actual_amount=0,snapshot_json=? WHERE id=?', [JSON.stringify(snapshot), old.statementId])
      expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'pay-healthy-project' })).netAmount).toMatchObject({ value: 0, state: 'known' })
    }
    finally { await f.close() }
  })

  it('确认核增100不会提前增加支出，实际补100才净1100，重复补发和反向伪退款均拒绝', async () => {
    const f = await createPayrollAdjustmentFixture()
    try {
      const correction = await f.correct(1100)
      expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1000)
      const command = await f.paymentCommand(correction.adjustment.id, 100)
      const result = await f.service.executeAdjustment(command)
      expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(1100)
      expect((await f.service.adjustmentDetail({ origin: 'real' }, correction.adjustment.id)).balance.remainingDelta.value).toBe(0)
      await expect(f.service.executeAdjustment(command)).resolves.toEqual(result)
      await expect(f.service.executeAdjustment(await f.paymentCommand(correction.adjustment.id, 100))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      await expect(f.refund(correction.adjustment.id, 100)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
      expect(await f.service.c2Output({ origin: 'real' }, f.statementId)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
    }
    finally { await f.close() }
  })
})

describe('实发月份范围', () => {
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
      const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('scope-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
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
})
