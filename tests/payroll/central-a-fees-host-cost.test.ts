import type { BusinessSession } from '../../server/utils/business-session'
import { expect, it } from 'vitest'
import { hasPayrollAFeesForm } from '~/lib/payroll/central-a-fees-contract'
import { loadPayrollHostSection } from '../../server/utils/crew-worker-payroll-read'
import { loadPayrollBudgetActual } from '../../server/utils/payroll-actual-budget'
import { aggregateTargetCostActual } from '../../server/utils/target-cost-actual'
import { createPayrollAFeeAdjustmentFixture } from '../helpers/payroll-a-fee-adjustment-fixture'

it.each(Array.from([['project', 'p'], ['crew', 'crew'], ['worker', 'w']] as const).map(input1 => ({ input1 })))('真实普通工资1000和含负价管理工资500经预算、项目、班组、个人、付款入口均只计1500：输入案例 %#', async ({ input1: [kind, id] }) => {
  const f = await createPayrollAFeeAdjustmentFixture()
  const session: BusinessSession = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'target-cost:read', 'project:list:read', 'crew:list:read', 'worker:list:read'] }
  try {
    await f.db.execute('UPDATE house_type_template_items SET field_qty=CASE item_id WHEN \'wall\' THEN 400 WHEN \'floor\' THEN 200 ELSE field_qty END')
    await f.prices()
    await f.saveFees([f.fee({ basis: { kind: 'completed-field-quantity', itemIds: ['wall', 'floor'], scope: { kind: 'project' } } }), f.fee({ kind: 'subsidy', name: '另一条独立补贴', unitPrice: 0.2 })])
    const draft = { ...f.draft, book: f.ordinary, payRatio: 1 }
    const ordinary = await f.service.execute(f.command(await f.form(draft), { kind: 'save-a-draft', draft }))
    await f.release(ordinary.statementId!, 1000)
    const m = await f.management()
    const managed = await m.start()
    const read = await f.service.aForm({ origin: 'real' }, { statementId: managed.statementId! })
    expect(read.totals.previouslyPaid.value).toBe(0)
    if (!hasPayrollAFeesForm(read))
      throw new Error('必须从真实管理草稿取得费用依据')
    const scope = { assignments: m.scope.assignments.map(a => ({ ...a, cells: a.cells.filter(c => c.itemId === 'shower') })).filter(a => a.cells.length) }
    await f.service.executeFees(f.feeCommand(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '未收尾代付', quantity: 30, unit: '套', unitPrice: -20, scope, reason: '只减少管理清单', evidenceNote: '原责任人确认30套未收尾，未关联第三方实际付款', actualRef: null }], remove: [] }))
    await f.release(managed.statementId!, 500)
    const ordinaryOutput = await f.service.aOutput({ origin: 'real' }, ordinary.statementId!)
    const managementOutput = await f.service.aOutput({ origin: 'real' }, managed.statementId!)
    expect(ordinaryOutput).toMatchObject({ state: 'available', document: { actualAmount: 1000 } })
    expect(managementOutput).toMatchObject({ state: 'available', document: { actualAmount: 500, fees: { totals: { managementAmount: { value: 1500 }, negativeAmount: { value: -600 }, listAmount: { value: 900 } } } } })

    async function assertAllHosts(amount: number, count: number) {
      const payments = await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })
      expect(payments.netAmount.value).toBe(amount)
      expect(payments.rows).toHaveLength(count)

      const section = await loadPayrollHostSection(f.db, { kind, id }, session)
      expect(section.netAmount.value, kind).toBe(amount)
      expect(section.rows).toHaveLength(count)
      expect(section.rows.map(r => r.fact.identity).sort()).toEqual(payments.rows.map(r => r.identity).sort())
      const sources = await loadPayrollBudgetActual(f.db, 'p', session)
      const budget = aggregateTargetCostActual('p', sources).categories.find(c => c.category === '工人工资')!
      expect(budget).toMatchObject({ paidAmount: { value: amount, status: 'complete' }, settledAmount: { value: amount, status: 'complete' }, signedAmount: { status: 'not-applicable' } })
      for (const source of sources)
        expect(source.rows.map(r => r.identity).sort()).toEqual(payments.rows.map(r => r.identity).sort())
      expect((await loadPayrollHostSection(f.db, { kind: 'worker', id: 'zero' }, session)).netAmount.value).toBe(0)
    }
    await assertAllHosts(1500, 2)
    expect(await f.db.select('SELECT id FROM payroll_actual_events')).toEqual([])
    const correction = await f.correct(managed.statementId!, (basis) => {
      basis.fees!.negativeLines[0]!.quantity = 35
    })
    expect(correction.adjustment.delta).toBe(-80)
    await assertAllHosts(1500, 2)
    await f.pay(correction.adjustment.id, -80)
    await assertAllHosts(1420, 3)
    expect((await f.service.aOutput({ origin: 'real' }, ordinary.statementId!)).document).toEqual(ordinaryOutput.document)
    expect((await f.service.aOutput({ origin: 'real' }, managed.statementId!)).document).toEqual(managementOutput.document)
  }
  finally { await f.close() }
}, 30_000)
