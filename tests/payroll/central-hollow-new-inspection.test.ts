import { expect, it } from 'vitest'
import { createPayrollHollowFixture } from '../helpers/payroll-hollow-fixture'

it('原15处已扣、5处仍未修、新增2处时后单仅人工启动新增2处，后续整改不退款', async () => {
  const f = await createPayrollHollowFixture()
  try {
    const august = (await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))).statementId!
    const augustRead = () => f.service.aForm({ origin: 'real' }, { statementId: august })
    await f.service.executeHollow(f.startCommand((await augustRead()).hollow!))
    await f.service.execute(f.command(await augustRead(), { kind: 'check-a' }))
    await f.service.execute(f.command(await augustRead(), { kind: 'release-a', release: { actualAmount: 550, allocations: [{ workerId: f.draft.leaderWorkerId, amount: 550 }] } }))
    const original = await f.service.aOutput({ origin: 'real' }, august)

    let quantity = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(quantity, { kind: 'rectify-hollow-inspection', recordId: f.recordId, expectedRevisionId: quantity.data.records[0]!.inspection.revisionId, rectifiedOn: '2026-09-01', count: 10, note: '原已扣15处再修10处，仍有5处未修' }))
    quantity = await f.quantityService.hollow(f.scope)
    await f.quantityService.executeHollow(f.hollowCommand(quantity, { kind: 'create-hollow-inspection', target: f.target, input: { inspectedOn: '2026-09-02', count: 2, note: '另外新增2处，独立排查，不修订原已采用记录' } }))
    quantity = await f.quantityService.hollow(f.scope)
    const added = quantity.data.records.find(row => row.recordId !== f.recordId)!
    const draft = { ...f.draft, month: '2026-09', payRatio: 1 }
    const initial = await f.form(draft, 'hollow-september-new-two')
    expect(initial.hollow?.rows.find(row => row.fact.recordId === f.recordId)).toMatchObject({ state: 'already-processed', amount: { value: 0 }, fact: { remainingCount: 5 } })
    expect(initial.hollow?.rows.find(row => row.fact.recordId === added.recordId)).toMatchObject({ state: 'ready', amount: { value: 60 }, fact: { remainingCount: 2 } })
    expect(initial.hollow?.snapshot?.start).toBeNull()
    expect(initial.hollow?.totals.currentDeduction.value).toBe(0)
    expect(initial.totals.grossAmount.value).toBe(500)

    const september = (await f.service.execute(f.command(initial, { kind: 'save-a-draft', draft }))).statementId!
    const septemberRead = () => f.service.aForm({ origin: 'real' }, { statementId: september })
    expect((await septemberRead()).hollow?.snapshot?.start).toBeNull()
    const start = f.startCommand((await septemberRead()).hollow!)
    const result = await f.service.executeHollow(start)
    expect(await f.service.executeHollow(start)).toEqual(result)
    const started = await septemberRead()
    expect(started.hollow?.snapshot?.start?.lines.map(line => line.fact.recordId)).toEqual([added.recordId])
    expect(started.hollow?.totals.currentDeduction.value).toBe(60)
    expect(started.totals.grossAmount.value).toBe(440)
    await f.service.execute(f.command(started, { kind: 'check-a' }))
    await f.service.execute(f.command(await septemberRead(), { kind: 'release-a', release: { actualAmount: 440, allocations: [{ workerId: draft.leaderWorkerId, amount: 440 }] } }))
    const later = await f.service.aOutput({ origin: 'real' }, september)
    expect(later).toMatchObject({ state: 'available', document: { actualAmount: 440 } })
    expect(await f.db.select('SELECT record_id,statement_id FROM payroll_hollow_adoptions ORDER BY statement_id')).toEqual(expect.arrayContaining([{ record_id: f.recordId, statement_id: august }, { record_id: added.recordId, statement_id: september }]))

    for (const [recordId, count] of [[f.recordId, 5], [added.recordId, 2]] as const) {
      quantity = await f.quantityService.hollow(f.scope)
      const record = quantity.data.records.find(row => row.recordId === recordId)!
      await f.quantityService.executeHollow(f.hollowCommand(quantity, { kind: 'rectify-hollow-inspection', recordId, expectedRevisionId: record.inspection.revisionId, rectifiedOn: '2026-10-01', count, note: '后来全部修复，不能自动退款' }))
    }
    const cold = f.reloadPayroll()
    expect((await cold.aOutput({ origin: 'real' }, august)).document).toEqual(original.document)
    expect((await cold.aOutput({ origin: 'real' }, september)).document).toEqual(later.document)
    expect((await cold.actualLedger({ origin: 'real' }, { projectId: draft.projectId })).netAmount.value).toBe(990)
    const october = await cold.aForm({ origin: 'real' }, { statementId: null, draftKey: 'hollow-october-after-repair', draft: { ...draft, month: '2026-10' } })
    expect(october.hollow?.rows.every(row => row.state === 'already-processed' && row.amount.value === 0)).toBe(true)
    expect(october.hollow?.eligibility.canStart).toBe(false)
    expect(october.totals.grossAmount.value).toBe(0)
  }
  finally { await f.close() }
}, 30_000)
