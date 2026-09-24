import type { PayrollBatchConfirmCommand, PayrollBatchPreviewRead } from '../../app/lib/payroll/central-batch-service-contract'
import { expect, it } from 'vitest'
import { createPayrollAServiceFixture, payrollAFact } from '../helpers/payroll-a-service-fixture'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

function confirm(read: PayrollBatchPreviewRead): PayrollBatchConfirmCommand {
  return { schemaVersion: 1, commandId: 'remainder-confirm', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'confirm-batch', input: { purpose: 'release', projectId: read.input.projectId, month: read.input.month, previewVersion: read.previewVersion, fundingAmountFen: read.input.fundingAmountFen, items: read.items.map((item) => {
    const amount = read.funding!.items.find(row => row.itemId === item.target.itemId)!.suggestedAmountFen!
    return { ...item.target, decision: amount ? { kind: 'release', actualAmountFen: amount, allocations: item.members.map((member, index) => ({ workerId: member.workerId, amountFen: index ? 0 : amount })) } : { kind: 'defer' } }
  }) } } }
}

it('冷读稳定簿身份分出333.34/333.33/333.33，三份原工资实际合计1000且不重复发放', async () => {
  const f = await createPayrollAServiceFixture()
  try {
    f.source.workers.push({ id: 'third', name: '第三负责人', crewId: 'crew' })
    f.source.workers.find(row => row.id === 'w')!.name = '同名负责人'
    f.source.workers.find(row => row.id === 'other')!.name = '同名负责人'
    const workers = ['w', 'other', 'third']
    f.facts.rows = workers.map(workerId => payrollAFact({ ownershipKey: workerId, completionId: `${workerId}-complete`, assignmentId: `${workerId}-assignment`, unitId: `${workerId}-unit`, roomId: `${workerId}-room`, workerId, fieldQty: 1 }))
    await f.config()
    await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
    const statementIds: string[] = []
    for (const leaderWorkerId of workers) {
      const config = await f.service.aConfig({ origin: 'real' }, { projectId: 'p', crewId: 'crew', leaderWorkerId, month: '2026-08' })
      await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 1000, scope: { kind: 'project' } }] }))
      const draft = { ...f.draft, leaderWorkerId, memberWorkerIds: leaderWorkerId === 'w' ? ['w', 'zero'] : [leaderWorkerId], payRatio: 1 }
      const form = await f.form(draft, `${leaderWorkerId}-draft`)
      const saved = await f.service.execute(f.command(form, { kind: 'save-a-draft', draft }))
      statementIds.push(saved.statementId!)
      const scope = { projectId: 'p', leaderWorkerId, book: { bookPurpose: 'ordinary' as const, managementBookId: null }, month: '2026-08' }
      const rounding = await f.service.aRounding({ origin: 'real' }, scope)
      await f.service.executeARounding({ schemaVersion: 1, commandId: `round-${leaderWorkerId}`, workspaceId: rounding.context.workspaceId, actorId: rounding.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: rounding.context.sourceVersion, scope, action: { kind: 'save-a-rounding', rule: { kind: 'floor', stepFen: 10_000 } } })
    }
    for (const statementId of statementIds)
      await f.service.execute(f.command(await f.service.aForm({ origin: 'real' }, { statementId }), { kind: 'check-a' }))
    const query = { origin: 'real' as const, projectId: 'p', month: '2026-08' }
    const input = { purpose: 'release' as const, projectId: 'p', month: '2026-08', statementIds, fundingAmountFen: 100_000 }
    const read = await f.service.batchPreview(query, input)
    const reversed = await f.service.batchPreview(query, { ...input, statementIds: [...statementIds].reverse() })
    const amounts = (value: PayrollBatchPreviewRead) => Object.fromEntries(value.funding!.items.map(row => [row.itemId, row.suggestedAmountFen]))
    expect(amounts(read)).toEqual({ [statementIds[0]!]: 33_333, [statementIds[1]!]: 33_334, [statementIds[2]!]: 33_333 })
    expect(amounts(reversed)).toEqual(amounts(read))
    expect(new Set(read.funding!.items.map(row => row.bookKey)).size).toBe(3)
    let plan = await f.service.executeBatch(confirm(read))
    expect(plan.outcomes.every(row => row.state === 'pending' && row.actualAmountFen === null)).toBe(true)
    expect(await f.service.batch(query, plan.planId)).toEqual(plan)
    for (let index = 0; index < 3; index++) {
      const common = { schemaVersion: 1 as const, workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const }
      const prepared = await f.service.executeBatch({ ...common, commandId: `prepare-${index}`, action: { kind: 'prepare-batch-item', input: { planId: plan.planId, planVersion: plan.planVersion, executeCommandId: `execute-${index}` } } })
      const command = { ...common, commandId: `execute-${index}`, action: { kind: 'execute-batch-original' as const, input: { planId: plan.planId, planVersion: prepared.planVersion } } }
      plan = await f.service.executeBatch(command)
      expect(await f.service.executeBatch(command)).toEqual(plan)
    }
    expect(plan.state).toBe('complete')
    expect(plan.outcomes.map(row => row.actualAmountFen)).toEqual([33_333, 33_334, 33_333])
    expect((await f.service.actualLedger(query, { projectId: 'p' })).netAmount.value).toBe(1000)
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-a\'')).toHaveLength(3)
    expect((await f.service.aOutput(query, statementIds[0]!))).toMatchObject({ state: 'available', document: { actualAmount: 333.33, allocations: [{ workerId: 'w', amount: 333.33 }, { workerId: 'zero', amount: 0 }] } })
  }
  finally { await f.close() }
})

it('真实已启动空鼓工资资金不足时固定暂缓计划，不把零建议发成工资或批次错误', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const statementId = saved.statementId!
    const current = () => f.service.aForm({ origin: 'real' }, { statementId })
    await f.service.executeHollow(f.startCommand((await current()).hollow!))
    const scope = { projectId: f.draft.projectId, leaderWorkerId: f.draft.leaderWorkerId, book: f.draft.book!, month: f.draft.month }
    const rounding = await f.service.aRounding({ origin: 'real' }, scope)
    await f.service.executeARounding({ schemaVersion: 1, commandId: 'full-round', workspaceId: rounding.context.workspaceId, actorId: rounding.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: rounding.context.sourceVersion, scope, action: { kind: 'save-a-rounding', rule: { kind: 'floor', stepFen: 10_000 } } })
    await f.service.execute(f.command(await current(), { kind: 'check-a' }))
    const query = { origin: 'real' as const, projectId: scope.projectId, month: scope.month }
    const input = { purpose: 'release' as const, projectId: scope.projectId, month: scope.month, statementIds: [statementId], fundingAmountFen: 50_000 }
    const read = await f.service.batchPreview(query, input)
    expect(read.items[0]).toMatchObject({ eligibleAmountFen: 55_000, requiresFullAmount: true })
    expect(read.funding).toMatchObject({ state: 'ready', suggestedTotalFen: 0, unallocatedFen: 50_000 })
    expect(read.reasons.join(' ')).toContain('整单')
    const affordable = await f.service.batchPreview(query, { ...input, fundingAmountFen: 60_000 })
    expect(affordable.funding).toMatchObject({ state: 'ready', suggestedTotalFen: 55_000, unallocatedFen: 5000 })
    const plan = await f.service.executeBatch(confirm(read))
    expect(plan).toMatchObject({ state: 'complete', outcomes: [{ state: 'deferred', actualAmountFen: null }] })
    expect((await current()).status).toBe('checked')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-a\'')).toEqual([])
  }
  finally { await f.close() }
}, 30_000)
