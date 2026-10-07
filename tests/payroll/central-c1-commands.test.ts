import { expect, it } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'

async function checked(f: Awaited<ReturnType<typeof createPayrollC1ServiceFixture>>, draft = f.draft, key = 'new-c1') {
  const read = await f.form(draft, key)
  const saved = await f.service.executeC1(f.command(read, { kind: 'save-c1-draft', draft }))
  const id = saved.statementId!
  await f.service.executeC1(f.command(await f.service.c1Form({ origin: 'real' }, { statementId: id }), { kind: 'check-c1' }))
  return f.service.c1Form({ origin: 'real' }, { statementId: id })
}
it.each([
  { label: '漏填成员', allocations: [{ workerId: 'w', amount: 550 }, { workerId: 'member', amount: 350 }], reason: '组内分配必须包含负责人和全部成员，未分配成员请填 0' },
  { label: '分配合计不等于实发', allocations: [{ workerId: 'w', amount: 550.01 }, { workerId: 'member', amount: 350 }, { workerId: 'zero', amount: 0 }], reason: '成员分配合计必须等于实际发放金额' },
  { label: '同一成员重复分配', allocations: [{ workerId: 'w', amount: 550 }, { workerId: 'w', amount: 550 }, { workerId: 'zero', amount: 0 }], reason: '同一成员不能重复分配实际发放金额' },
])('核算与实发分离，C1 发放拒绝$label', async ({ allocations, reason }) => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await f.attendance()
    await f.attendance({ workerId: 'member', hours: 7.5, overtimeHours: 0 })
    const read = await checked(f)
    const release = { actualAmount: 900, allocations: [{ workerId: 'w', amount: 550 }, { workerId: 'member', amount: 350 }, { workerId: 'zero', amount: 0 }] }
    await expect(f.service.executeC1(f.command(read, { kind: 'release-c1', release: { ...release, allocations } }))).rejects.toThrow(reason)
    const command = f.command(read, { kind: 'release-c1', release })
    const result = await f.service.executeC1(command)
    expect(await f.service.executeC1(command)).toEqual(result)
    await expect(f.service.executeC1({ ...command, action: { kind: 'release-c1', release: { ...release, actualAmount: 899 } } })).rejects.toThrow('编号')
    expect(await f.db.select('SELECT actual_amount,gross_amount FROM wage_statements')).toEqual([{ actual_amount: 900, gross_amount: 1051.25 }])
    expect((await f.service.c1Output({ origin: 'real' }, read.statementId!)).state).toBe('available')
    expect((await f.service.detail({ origin: 'real' }, read.statementId!)).statement.snapshot.state).toBe('complete')
    expect((await f.service.detail({ origin: 'real' }, read.statementId!)).statement.diagnostics.some(d => d.code === 'source-unproven')).toBe(false)
    await expect(f.service.executeC1(f.command(await f.service.c1Form({ origin: 'real' }, { statementId: read.statementId! }), { kind: 'check-c1' }))).rejects.toThrow('只可阅读')
  }
  finally { await f.close() }
})

it('两簿先核对后只能一份实发，第二份持久需重核；改单来源和标准也同事务标记', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await f.attendance()
    const first = await checked(f)
    const second = await checked(f, { ...f.draft, leaderWorkerId: 'member' }, 'other-c1')
    const refreshedFirst = await f.service.c1Form({ origin: 'real' }, { statementId: first.statementId! })
    const release = { actualAmount: 500, allocations: [{ workerId: 'w', amount: 500 }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] }
    await f.service.executeC1(f.command(refreshedFirst, { kind: 'release-c1', release }))
    const result = await f.service.executeC1(f.command(second, { kind: 'release-c1', release }))
    expect(result.outcome).toBe('needs-recheck')
    expect((await f.service.detail({ origin: 'real' }, second.statementId!)).statement.needsRecheck).toBe(true)
    expect((await f.db.select('SELECT id FROM wage_statements WHERE status=\'released\''))).toHaveLength(1)
  }
  finally { await f.close() }
})
