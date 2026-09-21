import type { PayrollADraft } from '../../app/lib/payroll/central-a-contract'
import type { PayrollARoundingCommand } from '../../app/lib/payroll/central-a-rounding-contract'
import type { PayrollBatchConfirmCommand, PayrollBatchPreviewRead } from '../../app/lib/payroll/central-batch-service-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { createPayrollAServiceFixture, payrollAFact } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => Promise.all(closers.splice(0).map(close => close())))

describe('central payroll batch preview and immutable confirmation', () => {
  it('freezes a proven 600/400 preview into a durable 300/200 plan without advancing payroll facts', async () => {
    const f = await createPayrollAServiceFixture()
    closers.push(f.close)
    f.facts.rows = [
      payrollAFact({ ownershipKey: 'left', completionId: 'left-complete', assignmentId: 'left-assignment', workerId: 'w', fieldQty: 1 }),
      payrollAFact({ ownershipKey: 'right', completionId: 'right-complete', assignmentId: 'right-assignment', unitId: 'u-right', roomId: 'r-right', workerId: 'other', fieldQty: 1 }),
    ]
    await f.config()
    await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')

    async function checked(leaderWorkerId: 'w' | 'other', unitPrice: number, draftKey: string) {
      const scope = { projectId: 'p', month: '2026-08', crewId: 'crew', leaderWorkerId }
      const config = await f.service.aConfig({ origin: 'real' }, scope)
      await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice, scope: { kind: 'project' } }] }))
      const draft: PayrollADraft = { projectId: 'p', crewId: 'crew', leaderWorkerId, memberWorkerIds: leaderWorkerId === 'w' ? ['w', 'zero'] : ['other'], month: '2026-08', periodKind: 'monthly', payRatio: 0.8, note: '' }
      const form = await f.service.aForm({ origin: 'real' }, { statementId: null, draftKey, draft })
      const saved = await f.service.execute(f.command(form, { kind: 'save-a-draft', draft }))
      const persisted = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      await f.service.execute(f.command(persisted, { kind: 'check-a' }))
      const checked = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      expect(checked.totals.grossAmount.value).toBe(unitPrice * 0.8)

      const roundingScope = { projectId: 'p', leaderWorkerId, book: { bookPurpose: 'ordinary' as const, managementBookId: null }, month: '2026-08' }
      const rounding = await f.service.aRounding({ origin: 'real' }, roundingScope)
      const command: PayrollARoundingCommand = { schemaVersion: 1, commandId: `round-${leaderWorkerId}`, workspaceId: rounding.context.workspaceId, actorId: rounding.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: rounding.context.sourceVersion, scope: roundingScope, action: { kind: 'save-a-rounding', rule: { kind: 'off' } } }
      await f.service.executeARounding(command)
      return saved.statementId!
    }

    const left = await checked('w', 750, 'left-draft')
    const right = await checked('other', 500, 'right-draft')
    for (const statementId of [left, right]) {
      const current = await f.service.aForm({ origin: 'real' }, { statementId })
      await f.service.execute(f.command(current, { kind: 'check-a' }))
    }
    const input = { purpose: 'release' as const, projectId: 'p', month: '2026-08', statementIds: [left, right], fundingAmountFen: 50_000 }
    const preview: PayrollBatchPreviewRead = await f.service.batchPreview({ origin: 'real', projectId: 'p', month: '2026-08' }, input)
    expect(preview.items.map(item => item.eligibleAmountFen)).toEqual([60_000, 40_000])
    expect(preview.funding?.items.map(item => item.suggestedAmountFen)).toEqual([30_000, 20_000])
    expect(preview.reasons).toEqual([])

    const decisions = preview.items.map((item, index) => ({ ...item.target, decision: { kind: 'release' as const, actualAmountFen: index ? 20_000 : 30_000, allocations: item.members.map((member, memberIndex) => ({ workerId: member.workerId, amountFen: memberIndex === 0 ? (index ? 20_000 : 30_000) : 0 })) } }))
    const command: PayrollBatchConfirmCommand = { schemaVersion: 1, commandId: 'confirm-batch', workspaceId: preview.context.workspaceId, actorId: preview.context.actorId, origin: 'real', requiredCapability: 'payroll:write', action: { kind: 'confirm-batch', input: { purpose: 'release', projectId: 'p', month: '2026-08', previewVersion: preview.previewVersion, fundingAmountFen: 50_000, items: decisions } } }
    const [before] = await f.db.select<{ revision: number }>('SELECT revision FROM payroll_revision WHERE singleton=1')
    const plan = await f.service.executeBatch(command)
    expect(plan).toMatchObject({ schemaVersion: 1, commandId: 'confirm-batch', projectId: 'p', month: '2026-08', purpose: 'release', fundingAmountFen: 50_000, state: 'ready', nextItemIndex: 0, expectedPayrollRevision: before!.revision })
    expect(plan.items.map(item => item.decision)).toEqual(decisions.map(item => item.decision))
    expect(await f.service.executeBatch(command)).toEqual(plan)
    expect(await f.service.batch({ origin: 'real', projectId: 'p', month: '2026-08' }, plan.planId)).toEqual(plan)
    expect((await f.db.select<{ revision: number }>('SELECT revision FROM payroll_revision WHERE singleton=1'))[0]!.revision).toBe(before!.revision)
    expect(await f.db.select('SELECT * FROM wage_statements WHERE status=\'released\'')).toEqual([])

    const prepareFirst = { schemaVersion: 1 as const, commandId: 'prepare-first', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, action: { kind: 'prepare-batch-item' as const, input: { planId: plan.planId, planVersion: plan.planVersion, executeCommandId: 'execute-first' } } }
    const firstPrepared = await f.service.executeBatch(prepareFirst)
    expect(firstPrepared).toMatchObject({ state: 'prepared', nextItemIndex: 0 })
    const [firstAttempt] = await f.db.select<Record<string, unknown>>('SELECT * FROM payroll_batch_attempts WHERE prepare_command_id=\'prepare-first\'')
    expect(firstAttempt).toMatchObject({ state: 'prepared', execute_command_id: 'execute-first', before_payroll_revision: before!.revision })
    expect(JSON.parse(String(firstAttempt!.command_json))).toMatchObject({ commandId: firstAttempt!.payroll_command_id, statementId: left, action: { kind: 'release-a', release: { actualAmount: 300 } } })
    expect(await f.db.select('SELECT * FROM payroll_command_receipts WHERE command_id=?', [firstAttempt!.payroll_command_id])).toEqual([])
    expect((await f.service.aForm({ origin: 'real' }, { statementId: left })).status).toBe('checked')

    const executeFirst = { schemaVersion: 1 as const, commandId: 'execute-first', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, action: { kind: 'execute-batch-original' as const, input: { planId: plan.planId, planVersion: firstPrepared.planVersion } } }
    const afterFirst = await f.service.executeBatch(executeFirst)
    expect(afterFirst).toMatchObject({ state: 'ready', nextItemIndex: 1, expectedPayrollRevision: before!.revision + 1 })
    expect((await f.service.aForm({ origin: 'real' }, { statementId: left })).status).toBe('released')
    expect(await f.service.executeBatch(executeFirst)).toEqual(afterFirst)

    const prepareSecond = { schemaVersion: 1 as const, commandId: 'prepare-second', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, action: { kind: 'prepare-batch-item' as const, input: { planId: plan.planId, planVersion: afterFirst.planVersion, executeCommandId: 'execute-second' } } }
    const secondPrepared = await f.service.executeBatch(prepareSecond)
    const executeSecond = { schemaVersion: 1 as const, commandId: 'execute-second', workspaceId: plan.context.workspaceId, actorId: plan.context.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, action: { kind: 'execute-batch-original' as const, input: { planId: plan.planId, planVersion: secondPrepared.planVersion } } }
    const complete = await f.service.executeBatch(executeSecond)
    expect(complete).toMatchObject({ state: 'complete', nextItemIndex: 2, expectedPayrollRevision: before!.revision + 2 })
    expect((await f.service.aForm({ origin: 'real' }, { statementId: right })).status).toBe('released')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-a\'')).toHaveLength(2)

    const changed = structuredClone(command)
    changed.action.input.fundingAmountFen = 50_001
    await expect(f.service.executeBatch(changed)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
})
