import type { PayrollAAction, PayrollACommandRead, PayrollAPriceRevision } from '../../app/lib/payroll/central-a-contract'
import { expect, it } from 'vitest'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { loadPayrollAManagementScopeFacts } from '../../server/utils/payroll-management-scope-facts'
import { loadPayrollAQuantityFacts } from '../../server/utils/payroll-quantity-facts'
import { createPayrollService } from '../../server/utils/payroll-service'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

async function fixture() {
  const native = await createPayrollAFeesFixture()
  const actor = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write', 'project:list:read', 'worker:list:read', 'crew:list:read'] }
  native.setSession(actor)
  await native.prices()
  await native.saveFees([native.fee()])
  const coordinator = createDbCoordinator(async () => native.db)
  const service = createPayrollService({ schemaInitialized: true, session: () => actor, identities: () => structuredClone(native.source), quantityFacts: loadPayrollAQuantityFacts, managementScopeFacts: loadPayrollAManagementScopeFacts, transaction: work => coordinator.withTransaction(tx => work(tx, actor)) })
  let sequence = 0
  const draft = { ...native.draft, book: native.ordinary, ratioPlan: { schemaVersion: 1 as const, itemRatios: ['wall', 'floor', 'shower'].map(itemId => ({ itemId, ratio: 0.8 })), feeRatios: [] } }
  const form = () => service.aForm({ origin: 'real' }, { statementId: null, draftKey: 'actual-a-input', draft })
  const config = () => service.aConfig({ origin: 'real' }, { projectId: 'p', crewId: 'crew', leaderWorkerId: 'w', month: '2026-08' })
  const command = (read: PayrollACommandRead, action: PayrollAAction) => ({ commandId: `a-consumed-${++sequence}`, workspaceId: actor.workspaceId, actorId: actor.actorId, origin: 'real' as const, requiredCapability: 'payroll:write' as const, projectId: 'p', sourceVersion: read.context.sourceVersion, statementId: 'statementId' in read ? read.statementId : null, draftKey: 'draftKey' in read ? read.draftKey : null, configScope: 'scope' in read ? read.scope : null, action })
  const changePrice = async (price: PayrollAPriceRevision, amount: number) => {
    const [original] = await native.db.select<Record<string, unknown>>('SELECT * FROM payroll_a_price_revisions WHERE id=?', [price.id])
    const next = { ...original!, id: `unrelated-price-revision-${++sequence}`, unit_price: amount, revision: price.revision + 1 }
    await native.db.execute(`INSERT INTO payroll_a_price_revisions(${Object.keys(next).join(',')}) VALUES(${Object.keys(next).map(() => '?').join(',')})`, Object.values(next))
  }
  const unrelated = async () => {
    native.source.workers.find(worker => worker.id === 'other')!.name = '未选择工人后来改名'
    await native.db.execute('INSERT INTO units(id,floor_id,house_type_template_id,code) VALUES(\'other-unit\',\'fee-floor\',\'fee-template\',\'202\')')
    await native.db.execute('INSERT INTO unit_assignments(id,unit_id,trade,worker_id) VALUES(\'other-assignment\',\'other-unit\',\'泥工\',\'other\')')
    for (const itemId of ['wall', 'floor', 'shower'])
      await native.db.execute('INSERT INTO unit_assignment_scopes(id,assignment_id,room_id,item_id) VALUES(?,?,?,?)', [`other-scope-${itemId}`, 'other-assignment', 'fee-room', itemId])
    await native.db.execute('INSERT INTO unit_stage_completions(id,unit_id,stage_id,assignment_id,status,completed_at) VALUES(\'other-completion\',\'other-unit\',\'fee-stage\',\'other-assignment\',\'completed\',\'2026-08-09\')')
  }
  return { ...native, service, actor, draft, form, config, command, changePrice, unrelated }
}
it('a同项目未选择工人和另一施工责任变化不阻止保存或已核工资发放，原冻结仍不变', async () => {
  const f = await fixture()
  try {
    const input = await f.form()
    const original = f.command(input, { kind: 'save-a-draft', draft: f.draft })
    await f.unrelated()
    const saved = await f.service.execute(original)
    let current = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.execute(f.command(current, { kind: 'check-a' }))
    current = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    const release = f.command(current, { kind: 'release-a', release: { actualAmount: 2984, allocations: [{ workerId: 'w', amount: 2984 }, { workerId: 'zero', amount: 0 }] } })
    await f.db.execute('UPDATE unit_stage_completions SET completed_at=\'2026-08-10\' WHERE id=\'other-completion\'')
    expect((await f.service.execute(release)).outcome).toBe('released')
    const output = await f.service.aOutput({ origin: 'real' }, saved.statementId!)
    expect(output.document?.actualAmount).toBe(2984)
    const raw = await f.db.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [saved.statementId])
    await f.changePrice(current.prices.find(price => price.itemId === 'wall')!, 40)
    expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).document).toEqual(output.document)
    expect(await f.db.select('SELECT snapshot_json FROM wage_statements WHERE id=?', [saved.statementId])).toEqual(raw)
  }
  finally { await f.close() }
})
it('a仅改所选价格时不因另一分项价格/另一责任/未选择工人变化冲突，所选原价变更仍拒绝', async () => {
  const f = await fixture()
  try {
    const read = await f.config()
    const wall = read.prices.find(price => price.itemId === 'wall')!
    const draft = { priceId: wall.priceId, itemId: wall.itemId, unit: wall.unit, mode: wall.mode, workerId: wall.workerId, effectiveMonth: '2026-08', unitPrice: 37, scope: wall.scope }
    const original = f.command(read, { kind: 'save-a-prices', prices: [draft] })
    await f.changePrice(read.prices.find(price => price.itemId === 'floor')!, 7)
    await f.unrelated()
    expect((await f.service.execute(original)).priceRevisionIds).toHaveLength(1)
    const next = await f.config()
    const selected = next.prices.find(price => price.itemId === 'wall' && price.revision === 2)!
    const stale = f.command(next, { kind: 'save-a-prices', prices: [{ ...draft, unitPrice: 38 }] })
    await f.changePrice(selected, 39)
    await expect(f.service.execute(stale)).rejects.toMatchObject({ problem: { code: 'stale-source', commandOutcome: 'not-applied' } })
  }
  finally { await f.close() }
})
it('a比例配置只消费本人配置及已发月锁，选定量/价变化仍按原发放needs-recheck协议处理', async () => {
  const f = await fixture()
  try {
    const config = await f.config()
    await f.changePrice(config.prices.find(price => price.itemId === 'wall')!, 37)
    await f.unrelated()
    await f.service.execute(f.command(config, { kind: 'save-a-subject-config', config: { crewId: 'crew', leaderWorkerId: 'w', initialPayRatio: 0.8 } }))
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    let current = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.execute(f.command(current, { kind: 'check-a' }))
    current = await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    const original = f.command(current, { kind: 'release-a', release: { actualAmount: current.totals.grossAmount.value, allocations: [{ workerId: 'w', amount: current.totals.grossAmount.value }, { workerId: 'zero', amount: 0 }] } })
    await f.db.execute('UPDATE house_type_template_items SET field_qty=101 WHERE id=\'fee-line-wall\'')
    expect((await f.service.execute(original)).outcome).toBe('needs-recheck')
    expect((await f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })).needsRecheck).toBe(true)
    expect(await f.db.select('SELECT id FROM wage_statements WHERE status=\'released\'')).toEqual([])
  }
  finally { await f.close() }
})
