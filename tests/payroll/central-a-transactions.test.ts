import { afterEach, describe, expect, it } from 'vitest'
import { createPayrollAServiceFixture } from '../helpers/payroll-a-service-fixture'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
async function fixture() {
  const f = await createPayrollAServiceFixture()
  closers.push(f.close)
  const config = await f.config()
  await f.db.execute('INSERT INTO items(id,project_id,code,name,trade,unit) VALUES(\'item\',\'p\',\'WALL\',\'墙砖\',\'泥工\',\'㎡\')')
  await f.service.execute(f.command(config, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 200, scope: { kind: 'project' } }] }))
  return f
}
describe('工资核对后的事务复验与不可重复发放', () => {
  it('同主体月份档位不能以另一草稿键再存一张；并行新簿不能重领同一完成责任', async () => {
    const f = await fixture()
    const first = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    await expect(f.service.execute(f.command(await f.form({}, 'different-key'), { kind: 'save-a-draft', draft: f.draft }))).rejects.toMatchObject({ problem: { code: 'conflict' } })
    const read = () => f.service.aForm({ origin: 'real' }, { statementId: first.statementId! })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    await f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 900, allocations: [{ workerId: 'w', amount: 900 }, { workerId: 'zero', amount: 0 }] } }))
    const otherScope = { projectId: 'p', month: '2026-08', crewId: 'crew', leaderWorkerId: 'other' }
    const otherConfig = await f.service.aConfig({ origin: 'real' }, otherScope)
    await f.service.execute(f.command(otherConfig, { kind: 'save-a-prices', prices: [{ priceId: null, itemId: 'item', unit: '㎡', mode: 'baseline', workerId: null, effectiveMonth: '2026-08', unitPrice: 200, scope: { kind: 'project' } }] }))
    f.facts.rows[0]!.completionId = 'rebuilt-completion'
    const draft = { ...f.draft, leaderWorkerId: 'other', memberWorkerIds: ['other', 'w', 'zero'] }
    await expect(f.service.execute(f.command(await f.form(draft, 'other-book'), { kind: 'save-a-draft', draft }))).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await f.db.select('SELECT id FROM wage_statements')).toHaveLength(1)
  })
  it('两张预先核对单先后发放，第二单留下需重核；改比例再核对不使用改后的默认值', async () => {
    const f = await fixture()
    const save = async (periodKind: 'monthly' | 'settlement', payRatio: number) => {
      const draft = { ...f.draft, periodKind, payRatio }
      const saved = await f.service.execute(f.command(await f.form(draft, periodKind), { kind: 'save-a-draft', draft }))
      const read = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
      await f.service.execute(f.command(await read(), { kind: 'check-a' }))
      return read
    }
    const first = await save('monthly', 0.8)
    const second = await save('settlement', 0.95)
    const oldSecond = await second()
    await f.service.execute(f.command(await first(), { kind: 'release-a', release: { actualAmount: 900, allocations: [{ workerId: 'w', amount: 900 }, { workerId: 'zero', amount: 0 }] } }))
    const result = await f.service.execute(f.command(oldSecond, { kind: 'release-a', release: { actualAmount: 600, allocations: [{ workerId: 'w', amount: 600 }, { workerId: 'zero', amount: 0 }] } }))
    expect(result.outcome).toBe('needs-recheck')
    expect((await second()).needsRecheck).toBe(true)
    await f.service.execute(f.command(await second(), { kind: 'set-a-pay-ratio', payRatio: 0.9 }))
    f.source.crews[0]!.defaultPayRatio = 0.6
    f.source.crews[0]!.ratioExplicitlyConfigured = true
    await f.service.execute(f.command(await second(), { kind: 'check-a' }))
    expect((await second()).totals.grossAmount.value).toBe(540)
    expect((await second()).draft.payRatio).toBe(0.9)
  })
  it('合计与时间相同但完成身份改变，发放保存需重核；输出永不补当前量价姓名', async () => {
    const f = await fixture()
    const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
    const read = () => f.service.aForm({ origin: 'real' }, { statementId: saved.statementId! })
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    const original = await read()
    f.facts.rows[0]!.completionId = 'replacement-completion'
    const result = await f.service.execute(f.command(original, { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'zero', amount: 0 }] } }))
    expect(result.outcome).toBe('needs-recheck')
    expect((await read()).needsRecheck).toBe(true)
    await f.service.execute(f.command(await read(), { kind: 'check-a' }))
    await expect(f.service.execute(f.command(await read(), { kind: 'release-a', release: { actualAmount: 1000, allocations: [] } }))).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
    const command = f.command(await read(), { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'zero', amount: 0 }] } })
    const released = await f.service.execute(command)
    const output = await f.service.aOutput({ origin: 'real' }, saved.statementId!)
    expect(output.state).toBe('available')
    f.source.workers[0]!.name = '当前改名'
    f.facts.rows[0]!.fieldQty = null
    expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).document).toEqual(output.document)
    expect(await f.service.execute(command)).toEqual(released)
    await expect(f.service.execute({ ...command, action: { kind: 'check-a' } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
  it('最后等待后撤权回滚全部事实与回执，缺权请求不能以候选页绕过', async () => {
    const f = await fixture()
    const read = await f.form()
    const before = await f.db.select('SELECT * FROM operation_logs')
    let reads = 0
    f.setIdentityHook(() => {
      if (++reads === 2)
        f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
    })
    await expect(f.service.execute(f.command(read, { kind: 'save-a-draft', draft: f.draft }))).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.db.select('SELECT * FROM wage_statements')).toEqual([])
    expect(await f.db.select('SELECT * FROM operation_logs')).toEqual(before)
  })
})
