import { afterEach, describe, expect, it, vi } from 'vitest'
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
    // 条件：同簿1600元施工，月度80%与结算95%均已核对；动作：先实发900，再提交旧结算。
    // 结果：旧结算不落款，重核90%后只剩540；防止旧预览绕过此前实付，重复发工资。
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
    expect(await f.db.select('SELECT status,actual_amount,snapshot_json FROM wage_statements WHERE id=?', [oldSecond.statementId])).toEqual([
      { status: 'checked', actual_amount: null, snapshot_json: null },
    ])
    expect(await f.db.select('SELECT worker_id,allocated_amount_fen FROM wage_statement_allocations WHERE statement_id=?', [oldSecond.statementId])).toEqual([])
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(900)
    await f.service.execute(f.command(await second(), { kind: 'set-a-pay-ratio', payRatio: 0.9 }))
    f.source.crews[0]!.defaultPayRatio = 0.6
    f.source.crews[0]!.ratioExplicitlyConfigured = true
    await f.service.execute(f.command(await second(), { kind: 'check-a' }))
    expect((await second()).totals.grossAmount.value).toBe(540)
    expect((await second()).draft.payRatio).toBe(0.9)
  })
  it('合计与时间相同但完成身份改变，发放保存需重核；输出永不补当前量价姓名', async () => {
    // 条件：8㎡×200元、80%核对后更换完成身份；动作：拒绝旧核对，重核并实发1000后改名/缺量。
    // 结果：原件仍是1600施工、1280应发、1000实发及原成员分配；防止新事实污染已签工资。
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
    await f.service.execute(command)
    const output = await f.service.aOutput({ origin: 'real' }, saved.statementId!)
    expect(output).toMatchObject({ state: 'available', document: {
      leaderName: '负责人',
      workAmount: 1600,
      cumulativeAmount: 1280,
      previouslyPaid: 0,
      grossAmount: 1280,
      actualAmount: 1000,
      lines: [expect.objectContaining({ workerId: 'w', quantity: 8, unitPrice: 200, amount: 1600 })],
      allocations: [
        { workerId: 'w', workerName: '负责人', isLeader: true, amount: 1000, allocatedAmountFen: 100000 },
        { workerId: 'zero', workerName: '零成员', isLeader: false, amount: 0, allocatedAmountFen: 0 },
      ],
    } })
    f.source.workers[0]!.name = '当前改名'
    f.facts.rows[0]!.fieldQty = null
    expect((await f.service.aOutput({ origin: 'real' }, saved.statementId!)).document).toEqual(output.document)
    await expect(f.service.execute({ ...command, action: { kind: 'check-a' } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
  })
  it.each(['保存草稿时撤权', '发放时撤权', '发放提交失败'] as const)('%s：全部事实回滚，恢复后原命令只落账一次', async (failure) => {
    // 条件：施工1600元、应发1280元；动作：保存或实发1000的最后边界撤权/拒绝COMMIT，再重试原键。
    // 结果：失败保留原头行、成员、分配、来源、归属、日志、版本和回执；恢复仅一次生效。
    // 防止“返回失败却留下半张工资/成功回执”，以及重试造成双重实付。
    const f = await fixture()
    const releasing = failure !== '保存草稿时撤权'
    let statementId: string | null = null
    if (releasing) {
      const saved = await f.service.execute(f.command(await f.form(), { kind: 'save-a-draft', draft: f.draft }))
      statementId = saved.statementId!
      await f.service.execute(f.command(await f.service.aForm({ origin: 'real' }, { statementId }), { kind: 'check-a' }))
    }
    const read = statementId ? await f.service.aForm({ origin: 'real' }, { statementId }) : await f.form()
    const command = f.command(read, releasing
      ? { kind: 'release-a', release: { actualAmount: 1000, allocations: [{ workerId: 'w', amount: 1000 }, { workerId: 'zero', amount: 0 }] } }
      : { kind: 'save-a-draft', draft: f.draft })
    const tables = ['wage_statements', 'wage_statement_lines', 'wage_statement_members', 'wage_statement_allocations', 'payroll_a_statement_sources', 'payroll_a_statement_books', 'payroll_a_management_ownership', 'payroll_adjustment_applications', 'payroll_a_adjustment_coverage', 'operation_logs', 'payroll_command_receipts', 'payroll_revision']
    const persisted = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, await f.db.select(`SELECT * FROM ${table} ORDER BY rowid`)])))
    const before = await persisted()
    let reads = 0
    const execute = f.db.execute.bind(f.db)
    const fault = vi.spyOn(f.db, 'execute').mockImplementation(async (sql, params) => {
      if (failure === '发放提交失败' && sql === 'COMMIT')
        throw new Error('模拟 A 工资提交失败')
      await execute(sql, params)
    })
    if (failure !== '发放提交失败') {
      f.setIdentityHook(() => {
        if (++reads === 2)
          f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read'] })
      })
    }
    try {
      if (failure === '发放提交失败')
        await expect(f.service.execute(command)).rejects.toThrow('模拟 A 工资提交失败')
      else
        await expect(f.service.execute(command)).rejects.toMatchObject({ problem: { code: 'forbidden', commandOutcome: 'not-applied' } })
    }
    finally {
      fault.mockRestore()
      f.setIdentityHook(null)
    }
    expect(await persisted()).toEqual(before)
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(0)

    f.setSession({ workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write'] })
    const result = await f.service.execute(command)
    expect(result.outcome).toBe(releasing ? 'released' : 'saved')
    const committed = await persisted()
    expect(await f.service.execute(command)).toEqual(result)
    expect(await persisted()).toEqual(committed)
    expect(await f.db.select('SELECT status,actual_amount FROM wage_statements')).toEqual([
      { status: releasing ? 'released' : 'draft', actual_amount: releasing ? 1000 : null },
    ])
    expect(await f.db.select('SELECT worker_id,allocated_amount_fen FROM wage_statement_allocations WHERE deleted_at IS NULL ORDER BY worker_id')).toEqual(releasing
      ? [{ worker_id: 'w', allocated_amount_fen: 100000 }, { worker_id: 'zero', allocated_amount_fen: 0 }]
      : [])
    expect((await f.service.actualLedger({ origin: 'real' }, { projectId: 'p' })).netAmount.value).toBe(releasing ? 1000 : 0)
  })
})
