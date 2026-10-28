import type { PayrollAAction, PayrollACommandRead } from '../../app/lib/payroll/central-a-contract'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { decodePayrollAdjustmentRead } from '../../app/lib/payroll/central-adjustment-read-codec'
import { encodePayrollAdjustmentWire } from '../../app/lib/payroll/central-adjustment-wire'
import { createReleasedPayrollHollowSource, importPayrollHollowFixture } from '../helpers/payroll-hollow-migration-fixture'
import { cloneQuantityHollowSnapshot } from '../helpers/quantity-hollow-migration-fixture'

// 原库只造一次；每案克隆原库后各自真实迁入。
let source: Awaited<ReturnType<typeof createReleasedPayrollHollowSource>>
beforeAll(async () => {
  source = await createReleasedPayrollHollowSource()
})
afterAll(() => source?.close())

it('迁入原450扣款后真实更正300并补款150，再次迁入保留现金700与原冻结550', async () => {
  const f = await source.migrate()
  try {
    const target = { adjustmentId: null, draftKey: 'migrated-hollow-correction', originalStatementId: f.statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    const draft = { ...initial.draft, reason: '迁入后逐项复核原扣款处数', evidenceNote: '原责任记录证实重复登记5处，应从15处更正为10处', basis: { ...initial.draft.basis!, hollow: { ...initial.draft.basis!.hollow!, components: initial.draft.basis!.hollow!.components.map(row => ({ ...row, count: 10 })) } } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(preview.preview.delta.value).toBe(150)
    const common = { workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.scope.projectId }
    const saved = await f.service.executeAdjustment({ ...common, commandId: 'migrated-hollow-save-correction', sourceVersion: preview.context.sourceVersion, target, action: { kind: 'save-adjustment-draft', draft } })
    const ready = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: saved.adjustmentId! } })
    await f.service.executeAdjustment({ ...common, commandId: 'migrated-hollow-confirm-correction', sourceVersion: ready.context.sourceVersion, target: ready.target, action: { kind: 'confirm-adjustment' } })
    const paymentTarget = { kind: 'actual-payment', draftKey: 'migrated-hollow-actual', adjustmentIds: [saved.adjustmentId!] } as const
    const actual = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget })
    const payment = { kind: 'supplement' as const, occurredOn: '2026-09-01', amount: 150, evidenceNote: '经办人已经实际补发并核对收款150元', allocations: [{ workerId: f.id('workers', f.original.draft.leaderWorkerId), amount: 150 }], applications: [{ adjustmentId: saved.adjustmentId!, amount: 150, balanceVersion: actual.balances[0]!.balanceVersion }] }
    const paymentRead = await f.service.actualPaymentForm({ origin: 'real' }, { target: paymentTarget, draft: payment })
    await f.service.executeAdjustment({ ...common, commandId: 'migrated-hollow-confirm-actual', sourceVersion: paymentRead.context.sourceVersion, target: paymentTarget, action: { kind: 'confirm-actual-payment', payment } })
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: f.scope.projectId })).netAmount.value).toBe(700)
    const cloned = await cloneQuantityHollowSnapshot(await f.instance.exportSnapshotBytes())
    try {
      const second = await importPayrollHollowFixture(cloned, f.identities)
      try {
        const ledgerScope = { projectId: second.scope.projectId }
        const ledger = await second.service.actualLedger({ origin: 'real' }, ledgerScope)
        expect(ledger.netAmount.value).toBe(700)
        expect(decodePayrollAdjustmentRead(encodePayrollAdjustmentWire(ledger), 'actual-ledger', { origin: 'real' }, ledgerScope)).toEqual(ledger)
        const correction = await second.service.adjustmentDetail({ origin: 'real' }, second.id('payroll_adjustments', saved.adjustmentId!))
        expect(correction.balance.remainingDelta.value).toBe(0)
        expect(decodePayrollAdjustmentRead(encodePayrollAdjustmentWire(correction), 'adjustment-detail', { origin: 'real' }, correction.adjustment.id)).toEqual(correction)
        const output = await second.service.aOutput({ origin: 'real' }, second.id('wage_statements', f.statementId))
        expect(output).toMatchObject({ state: 'available', document: { actualAmount: 550 } })
        const thirdSource = await cloneQuantityHollowSnapshot(await second.instance.exportSnapshotBytes())
        try {
          const third = await importPayrollHollowFixture(thirdSource, second.identities)
          try {
            expect((await third.service.actualLedger({ origin: 'real' }, { projectId: third.scope.projectId })).netAmount.value).toBe(700)
          }
          finally { await third.close() }
        }
        finally { thirdSource.close() }
        const next = await second.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: null, draftKey: 'twice-migrated-hollow-correction', originalStatementId: second.id('wage_statements', f.statementId) } })
        expect(next.draft.basis?.hollow?.components[0]?.recordId).toBe(second.recordId)
        expect(next.draft.basis?.hollow?.components[0]?.count).toBe(10)
        expect(decodePayrollAdjustmentRead(encodePayrollAdjustmentWire(next), 'adjustment-form', { origin: 'real' }, { target: next.target })).toEqual(next)
      }
      finally { await second.close() }
    }
    finally { cloned.close() }
  }
  finally { await f.close() }
}, 30_000)

it('迁入后600更正确认与后月实发50再导出，原前缀版本及确认原件保持可证', async () => {
  const f = await source.migrate()
  try {
    const target = { adjustmentId: null, draftKey: 'migrated-rate40', originalStatementId: f.statementId } as const
    const initial = await f.service.adjustmentForm({ origin: 'real' }, { target })
    const draft = { ...initial.draft, reason: '迁入后核对原单处金额应为40元', evidenceNote: '原核对记录明确保留15处，仅纠正原单处金额', basis: { ...initial.draft.basis!, hollow: { ...initial.draft.basis!.hollow!, components: initial.draft.basis!.hollow!.components.map(row => ({ ...row, unitAmount: 40 })) } } }
    const preview = await f.service.adjustmentForm({ origin: 'real' }, { target, draft })
    expect(preview.preview.delta.value).toBe(-150)
    const common = { workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: f.scope.projectId }
    const correction = await f.service.executeAdjustment({ ...common, commandId: 'migrated-rate40-save', sourceVersion: preview.context.sourceVersion, target, action: { kind: 'save-adjustment-draft', draft } })
    const ready = await f.service.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: correction.adjustmentId! } })
    await f.service.executeAdjustment({ ...common, commandId: 'migrated-rate40-confirm', sourceVersion: ready.context.sourceVersion, target: ready.target, action: { kind: 'confirm-adjustment' } })
    let sequence = 0
    const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ ...common, commandId: `migrated-later50-${++sequence}`, sourceVersion: read.context.sourceVersion, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
    const workerId = f.id('workers', f.original.draft.leaderWorkerId)
    const config = await f.service.aConfig({ origin: 'real' }, { projectId: f.scope.projectId, month: '2026-09', crewId: null, leaderWorkerId: workerId })
    const price = config.prices[0]!
    await f.service.execute(command(config, { kind: 'save-a-prices', prices: [{ priceId: price.priceId, itemId: price.itemId, unit: price.unit, mode: 'baseline', workerId: null, effectiveMonth: '2026-09', unitPrice: 300, scope: price.scope }] }))
    const nextDraft = { ...f.original.draft, projectId: f.scope.projectId, leaderWorkerId: workerId, memberWorkerIds: [workerId], month: '2026-09' }
    const next = await f.service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'migrated-later50', draft: nextDraft })
    expect(next.hollow?.totals.previousProcessed.value).toBe(600)
    expect(next.totals.grossAmount.value).toBe(50)
    const saved = await f.service.execute(command(next, { kind: 'save-a-draft', draft: nextDraft }))
    const form = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.execute(command(await form(), { kind: 'check-a' }))
    const candidate = (await f.service.releaseAdjustmentPreview({ origin: 'real' }, { statementId: saved.statementId! })).candidates.find(row => row.adjustmentId === correction.adjustmentId)!
    await f.service.execute(command(await form(), { kind: 'release-a', release: { actualAmount: 50, allocations: [{ workerId, amount: 50 }], adjustmentApplications: [{ adjustmentId: candidate.adjustmentId, amount: -150, balanceVersion: candidate.balanceVersion, coverageVersion: candidate.coverageVersion }] } }))
    const native = await f.service.aOutput({ origin: 'real' }, saved.statementId!)
    expect(native.state).toBe('available')
    if (native.state !== 'available')
      throw new Error(JSON.stringify(native))
    const cloned = await cloneQuantityHollowSnapshot(await f.instance.exportSnapshotBytes())
    try {
      const second = await importPayrollHollowFixture(cloned, f.identities)
      try {
        const statementId = second.id('wage_statements', saved.statementId!)
        const output = await second.service.aOutput({ origin: 'real' }, statementId)
        expect(output.state).toBe('available')
        if (output.state !== 'available')
          throw new Error(JSON.stringify(output))
        expect(output.document.actualAmount).toBe(50)
        expect(output.document.hollow?.previousProcessed[0]?.sourceVersion).toBe(native.document.hollow?.previousProcessed[0]?.sourceVersion)
        expect(output.document.hollow?.previousProcessed[0]?.effectiveAmount.value).toBe(600)
        expect(output.document.hollow?.previousProcessed[0]?.adjustmentIds).toEqual([second.id('payroll_adjustments', correction.adjustmentId!)])
        await second.instance.withWorkspaceTransaction(tx => tx.execute('DELETE FROM payroll_command_receipts WHERE command_id=?', [second.id('payroll_command_receipts', 'migrated-rate40-confirm')]))
        await expect(second.reloadPayroll().aOutput({ origin: 'real' }, statementId)).rejects.toThrow(/^迁入工资 payroll_command_receipts\/\S+:migrated-rate40-confirm 的原行或证据已缺损，不能继续计算剩余$/)
      }
      finally { await second.close() }
    }
    finally { cloned.close() }
  }
  finally { await f.close() }
}, 30_000)
