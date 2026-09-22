import type { PayrollBatchConfirmCommand } from '../../app/lib/payroll/central-batch-service-contract'
import { expect, it } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

it('persists and executes the original C1 command before completing a one-item plan', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await f.attendance()
    await f.attendance({ workerId: 'member', hours: 7.5, overtimeHours: 0 })
    const draft = await f.form()
    const saved = await f.service.executeC1(f.command(draft, { kind: 'save-c1-draft', draft: f.draft }))
    const current = () => f.service.c1Form({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.executeC1(f.command(await current(), { kind: 'check-c1' }))
    const query = { origin: 'real' as const, projectId: 'p', month: '2026-08' }
    const input = { purpose: 'release' as const, projectId: 'p', month: '2026-08', statementIds: [saved.statementId!], fundingAmountFen: 105_125 }
    const preview = await f.service.batchPreview(query, input)
    expect(preview.items[0]).toMatchObject({ eligibleAmountFen: 105_125, rounding: { state: 'not-applicable' } })
    const allocations = preview.items[0]!.members.map((member, index) => ({ workerId: member.workerId, amountFen: index ? 0 : 105_125 }))
    const confirm: PayrollBatchConfirmCommand = { schemaVersion: 1, commandId: 'c1-batch-confirm', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'confirm-batch', input: { purpose: 'release', projectId: 'p', month: '2026-08', previewVersion: preview.previewVersion, fundingAmountFen: 105_125, items: [{ ...preview.items[0]!.target, decision: { kind: 'release', actualAmountFen: 105_125, allocations } }] } } }
    const plan = await f.service.executeBatch(confirm)
    const prepared = await f.service.executeBatch({ schemaVersion: 1, commandId: 'c1-batch-prepare', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'prepare-batch-item', input: { planId: plan.planId, planVersion: plan.planVersion, executeCommandId: 'c1-batch-execute' } } })
    const [attempt] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_attempts WHERE prepare_command_id=\'c1-batch-prepare\'')
    const original = JSON.parse(String(attempt!.command_json))
    expect(original).toMatchObject({ statementId: saved.statementId, action: { kind: 'release-c1', release: { actualAmount: 1051.25 } } })
    expect((await current()).status).toBe('checked')
    // 模拟原工资事务成功后协调响应丢失：计划仍为 prepared，恢复只能重放同一原键正文。
    await f.service.executeC1(original)
    expect((await f.service.batch(query, plan.planId)).state).toBe('prepared')
    const complete = await f.service.executeBatch({ schemaVersion: 1, commandId: 'c1-batch-execute', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'execute-batch-original', input: { planId: plan.planId, planVersion: prepared.planVersion } } })
    expect(complete).toMatchObject({ state: 'complete', nextItemIndex: 1 })
    expect((await current()).status).toBe('released')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE command_id=?', [attempt!.payroll_command_id])).toHaveLength(1)
  }
  finally { await f.close() }
})

it('persists and executes the original C2 command before completing a one-item plan', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const checked = await createCheckedPayrollC2(f)
    const query = { origin: 'real' as const, projectId: 'p', month: '2026-08' }
    const input = { purpose: 'release' as const, projectId: 'p', month: '2026-08', statementIds: [checked.statementId!], fundingAmountFen: 52_500 }
    const preview = await f.service.batchPreview(query, input)
    expect(preview.items[0]).toMatchObject({ eligibleAmountFen: 52_500, rounding: { state: 'not-applicable' } })
    const allocations = preview.items[0]!.members.map((member, index) => ({ workerId: member.workerId, amountFen: index ? 0 : 52_500 }))
    const confirm: PayrollBatchConfirmCommand = { schemaVersion: 1, commandId: 'c2-batch-confirm', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'confirm-batch', input: { purpose: 'release', projectId: 'p', month: '2026-08', previewVersion: preview.previewVersion, fundingAmountFen: 52_500, items: [{ ...preview.items[0]!.target, decision: { kind: 'release', actualAmountFen: 52_500, allocations } }] } } }
    const plan = await f.service.executeBatch(confirm)
    const prepared = await f.service.executeBatch({ schemaVersion: 1, commandId: 'c2-batch-prepare', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'prepare-batch-item', input: { planId: plan.planId, planVersion: plan.planVersion, executeCommandId: 'c2-batch-execute' } } })
    const [attempt] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_attempts WHERE prepare_command_id=\'c2-batch-prepare\'')
    expect(JSON.parse(String(attempt!.command_json))).toMatchObject({ statementId: checked.statementId, action: { kind: 'release-c2', release: { actualAmount: 525 } } })
    expect((await f.service.c2Form({ origin: 'real' }, { statementId: checked.statementId! })).status).toBe('checked')
    const complete = await f.service.executeBatch({ schemaVersion: 1, commandId: 'c2-batch-execute', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'execute-batch-original', input: { planId: plan.planId, planVersion: prepared.planVersion } } })
    expect(complete).toMatchObject({ state: 'complete', nextItemIndex: 1 })
    expect((await f.service.c2Form({ origin: 'real' }, { statementId: checked.statementId! })).status).toBe('released')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE command_id=?', [attempt!.payroll_command_id])).toHaveLength(1)
  }
  finally { await f.close() }
})
