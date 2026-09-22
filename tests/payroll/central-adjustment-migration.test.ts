import type { PayrollAdjustmentAction, PayrollAdjustmentFormRead } from '~/lib/payroll/central-adjustment-contract'
import type { PayrollC2Command, PayrollC2FormRead } from '~/lib/payroll/central-c2-contract'
import { afterEach, expect, it } from 'vitest'
import { upsertC2SubjectConfig } from '~/lib/payroll/daywork'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { importPayrollC2MigrationSource, seedPayrollC2MigrationSource } from '../helpers/payroll-c2-migration-source'

afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(resolveBusinessSession().workspaceId)
})

it('真实更正保存、确认及退款后重复迁入保原事实，无关原图可恢复，相关恢复整批拒绝', async () => {
  const db = await createMemoryDb()
  try {
    await seedPayrollC2MigrationSource(db)
    await db.execute('INSERT INTO projects(id,name) VALUES (\'other-project\',\'无关工程\')')
    await db.execute('INSERT INTO workers(id,name,current_project_id) VALUES (\'other-worker\',\'无关负责人\',\'other-project\')')
    await upsertC2SubjectConfig(db, { projectId: 'other-project', crewId: null, leaderWorkerId: 'other-worker', unitRate: 500, ruleText: '' })
    const imported = await importPayrollC2MigrationSource(db)
    const { projectId, leaderWorkerId, workerId } = imported
    const config = await payrollService.c2Config({ origin: 'real' }, { projectId, leaderWorkerId })
    await payrollService.executeC2({ commandId: 'p4-config', workspaceId: config.context.workspaceId, actorId: config.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: config.context.sourceVersion, projectId, statementId: null, draftKey: null, configScope: config.scope, configId: config.config!.id, action: { kind: 'save-c2-config', config: { crewId: config.config!.crewId, unitRate: 2000, ruleText: '' } } })
    const draft = { projectId, leaderWorkerId, crewId: config.config!.crewId, memberWorkerIds: [leaderWorkerId, workerId], month: '2026-08', note: '' }
    const c2 = (read: PayrollC2FormRead, commandId: string, action: PayrollC2Command['action']): PayrollC2Command => ({ commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId, statementId: read.statementId, draftKey: read.draftKey, configScope: null, configId: null, action })
    const saved = await payrollService.executeC2(c2(await payrollService.c2Form({ origin: 'real' }, { statementId: null, draftKey: 'p4-wage', draft }), 'p4-save', { kind: 'save-c2-draft', draft }))
    const form = () => payrollService.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    await payrollService.executeC2(c2(await form(), 'p4-check', { kind: 'check-c2' }))
    await payrollService.executeC2(c2(await form(), 'p4-release', { kind: 'release-c2', release: { actualAmount: 1000, allocations: [{ workerId: leaderWorkerId, amount: 0 }, { workerId, amount: 1000 }] } }))
    const target = { adjustmentId: null, draftKey: 'p4-adjustment', originalStatementId: saved.statementId! } as const
    const initial = await payrollService.adjustmentForm({ origin: 'real' }, { target })
    if (initial.draft.basis?.formatFamily !== 'C2')
      throw new Error('须为真实 C2 来源')
    const adjustmentDraft = { ...initial.draft, reason: '原单价误录', evidenceNote: '负责人核对原签工应按1800计价', basis: { ...initial.draft.basis, unitRate: 1800 } }
    const adjustmentCommand = (read: PayrollAdjustmentFormRead, commandId: string, action: PayrollAdjustmentAction) => ({ commandId, workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, sourceVersion: read.context.sourceVersion, projectId, target: read.target, action })
    const correction = await payrollService.executeAdjustment(adjustmentCommand(await payrollService.adjustmentForm({ origin: 'real' }, { target, draft: adjustmentDraft }), 'p4-save-correction', { kind: 'save-adjustment-draft', draft: adjustmentDraft }))
    await payrollService.executeAdjustment(adjustmentCommand(await payrollService.adjustmentForm({ origin: 'real' }, { target: { adjustmentId: correction.adjustmentId! } }), 'p4-confirm-correction', { kind: 'confirm-adjustment' }))
    const paymentTarget = { kind: 'actual-payment' as const, draftKey: 'p4-refund', adjustmentIds: [correction.adjustmentId!] }
    const actual = await payrollService.actualPaymentForm({ origin: 'real' }, { target: paymentTarget })
    const payment = { kind: 'refund' as const, occurredOn: '2026-08-10', amount: -40, evidenceNote: '工人确已退回40', allocations: [{ workerId, amount: -40 }], applications: [{ adjustmentId: correction.adjustmentId!, amount: -40, balanceVersion: actual.balances[0]!.balanceVersion }] }
    const paymentForm = await payrollService.actualPaymentForm({ origin: 'real' }, { target: paymentTarget, draft: payment })
    await payrollService.executeAdjustment({ commandId: 'p4-refund-confirm', workspaceId: actual.context.workspaceId, actorId: actual.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: paymentForm.context.sourceVersion, projectId, target: paymentTarget, action: { kind: 'confirm-actual-payment', payment } })
    const readAll = () => quantityTestInstance.withWorkspaceTransaction(async (tx) => {
      const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name')
      return Object.fromEntries(await Promise.all(tables.map(async table => [table.name, await tx.select(`SELECT * FROM ${table.name} ORDER BY rowid`)])))
    })
    const authority = coreMigrationTestInstance.snapshot(imported.session)
    const before = await readAll()
    const repeat = await quantityTestInstance.prepareMigrationSnapshot(authority)
    repeat.commit()
    expect(await readAll()).toEqual(before)
    const unrelated = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(e => !(e.entityType === 'payroll_projects' && e.legacyId === 'other-project')) })
    await unrelated.abort()
    expect(await readAll()).toEqual(before)
    await expect(coreMigrationTestInstance.rollback({ ...imported.envelope('p4-rollback'), batchId: imported.batch.batchId }, imported.session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await readAll()).toEqual(before)
    expect((await payrollService.actualLedger({ origin: 'real' }, { projectId })).netAmount.value).toBe(960)
    expect((await payrollService.adjustmentDetail({ origin: 'real' }, correction.adjustmentId!)).balance.remainingDelta.value).toBe(-60)
    expect(await payrollService.c2Output({ origin: 'real' }, saved.statementId!)).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
  }
  finally { db.close() }
}, 30_000)
