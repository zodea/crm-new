import type { PayrollAPriceDraft } from '~/lib/payroll/central-a-contract'
import { afterEach, describe, expect, it } from 'vitest'
import { createPayrollAServiceFixture, payrollAFact } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
const price: PayrollAPriceDraft = { priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 200, scope: { kind: 'project' } }
async function fixture() {
  const f = await createPayrollAServiceFixture()
  closers.push(f.close)
  await f.config()
  await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
  return f
}
describe('中央 A 工资单价与比例的有效版本', () => {
  it('转组后可新建该班组价格，但不能把原价格身份改挂新班组', async () => {
    const f = await fixture()
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [price] }))
    const original = (await f.config()).prices[0]!
    f.source.crews.push({ id: 'next-crew', name: '新班组', defaultPayRatio: null, ratioExplicitlyConfigured: false })
    f.source.workers.forEach((worker) => {
      worker.crewId = 'next-crew'
    })
    f.source.version = 'new-crew-membership'
    const nextConfig = () => f.service.aConfig({ origin: 'real' }, { projectId: 'p', month: '2026-08', crewId: 'next-crew', leaderWorkerId: 'w' })
    expect((await nextConfig()).prices).toEqual([])
    const before = await f.db.select('SELECT * FROM payroll_a_price_revisions')
    const moved = f.command(await nextConfig(), { kind: 'save-a-prices', prices: [{ ...price, priceId: original.priceId, unitPrice: 210 }] })
    await expect(f.service.execute(moved)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect(await f.db.select('SELECT * FROM payroll_a_price_revisions')).toEqual(before)
    expect(await f.db.select('SELECT * FROM payroll_command_receipts WHERE command_id=?', [moved.commandId])).toEqual([])
    const saved = await f.service.execute(f.command(await nextConfig(), { kind: 'save-a-prices', prices: [{ ...price, unitPrice: 210 }] }))
    expect(saved.priceRevisionIds).toHaveLength(1)
    expect((await f.form({ crewId: 'next-crew' })).lines[0]?.unitPrice).toBe(210)
    expect((await nextConfig()).prices.map(row => row.crewId)).toEqual(['next-crew'])
    expect(await f.db.select('SELECT crew_id,unit_price FROM payroll_a_price_revisions WHERE price_id=?', [original.priceId])).toEqual([{ crew_id: 'crew', unit_price: 200 }])
  })
  it('已保存价格属于原班组主体，负责人转组后不能把原班组价隐式用于新主体', async () => {
    const f = await fixture()
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [price] }))
    f.source.crews.push({ id: 'next-crew', name: '新班组', defaultPayRatio: null, ratioExplicitlyConfigured: false })
    f.source.workers.forEach((worker) => {
      worker.crewId = 'next-crew'
    })
    f.source.version = 'new-crew-membership'
    const read = await f.form({ crewId: 'next-crew' })
    expect(read.options.crews.map(crew => crew.id)).toContain('next-crew')
    expect(read.lines[0]?.unitPrice).toBeNull()
    expect(read.eligibility.canSaveDraft).toBe(false)
  })
  it('从未发月份打开配置也不能把新价生效月设到另一个已发月份', async () => {
    const f = await fixture()
    await f.db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,period_kind,quantity_source,status,pay_ratio) VALUES(\'september\',\'p\',\'crew\',\'w\',\'2026-09\',\'A\',\'monthly\',\'field\',\'released\',0.8)')
    await expect(f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [{ ...price, effectiveMonth: '2026-09' }] }))).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await f.config()).prices).toEqual([])
  })
  it('缩小同一价格新修订范围后，被移除格子不复活旧价格', async () => {
    const f = await fixture()
    f.facts.rows.push(payrollAFact({ unitId: 'u2', ownershipKey: 'p:u2:a:r:item' }))
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [price] }))
    const old = (await f.config()).prices[0]!
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [{ ...price, priceId: old.priceId, unitPrice: 220, scope: { kind: 'cells', cells: [{ unitId: 'u', roomId: 'r', itemId: 'item' }] } }] }))
    const read = await f.form()
    expect(read.lines.find(line => line.facts.some(fact => fact.unitId === 'u'))?.unitPrice).toBe(220)
    expect(read.lines.find(line => line.facts.some(fact => fact.unitId === 'u2'))?.unitPrice).toBeNull()
    expect(read.eligibility.canSaveDraft).toBe(false)
  })
  it('跨次新增重叠基准价明确拒绝且不留价格、日志和回执', async () => {
    const f = await fixture()
    await f.service.execute(f.command(await f.config(), { kind: 'save-a-prices', prices: [price] }))
    const before = await f.db.select('SELECT * FROM operation_logs')
    const conflicting = f.command(await f.config(), { kind: 'save-a-prices', prices: [{ ...price, unitPrice: 100, scope: { kind: 'cells', cells: [{ unitId: 'u', roomId: 'r', itemId: 'item' }] } }] })
    await expect(f.service.execute(conflicting)).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    expect((await f.config()).prices).toHaveLength(1)
    expect(await f.db.select('SELECT * FROM operation_logs')).toEqual(before)
    expect(await f.db.select('SELECT * FROM payroll_command_receipts WHERE command_id=?', [conflicting.commandId])).toEqual([])
  })
  it('上月草稿零比例不回落；上月已发只用原冻结比例', async () => {
    const f = await fixture()
    await f.db.execute('INSERT INTO wage_statements(id,project_id,crew_id,leader_worker_id,month,format_family,period_kind,quantity_source,status,pay_ratio) VALUES(\'july\',\'p\',\'crew\',\'w\',\'2026-07\',\'A\',\'monthly\',\'field\',\'draft\',0)')
    expect((await f.form({ payRatio: undefined })).draft.payRatio).toBe(0)
    await f.db.execute('UPDATE wage_statements SET status=?,pay_ratio=?,snapshot_json=? WHERE id=?', ['released', 0.9, JSON.stringify({ payRatio: 0.7 }), 'july'])
    expect((await f.form({ payRatio: undefined })).draft.payRatio).toBe(0.7)
  })
})
