import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPayrollC1ServiceFixture } from '../helpers/payroll-c1-service-fixture'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

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

// subcontract-payroll.md 规则 8：本次应发为 0 或实际发放超过本次应发时禁止发放。
it('c1 实发超过当月应发或无空鼓抵扣的零额发放被拒绝，恰好等于应发可以发放', async () => {
  const f = await createPayrollC1ServiceFixture()
  try {
    await f.attendance()
    await f.attendance({ workerId: 'member', hours: 7.5, overtimeHours: 0 })
    const read = await checked(f)
    expect(read.totals.grossAmount.value).toBe(1051.25)
    const release = (actualAmount: number) => f.command(read, { kind: 'release-c1', release: { actualAmount, allocations: [{ workerId: 'w', amount: actualAmount }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] } })
    const rejection = 'C1 需重新核对完整，实际金额须到分且不超过当月应发；零额仅适用于明确启动并完整抵扣的空鼓处理'

    await expect(f.service.executeC1(release(1051.26))).rejects.toThrow(rejection)
    await expect(f.service.executeC1(release(0))).rejects.toThrow(rejection)
    expect(await f.db.select('SELECT actual_amount FROM wage_statements')).toEqual([{ actual_amount: null }])
    expect((await f.service.executeC1(release(1051.25))).outcome).toBe('released')
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

it('同日两段相邻半工可保存，待确认计入一工上限，重叠与第三半工拒绝且不留回执', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.daywork({ startTime: '08:00', endTime: '12:00', laborUnits: 0.5 })
    await expect(f.daywork({ startTime: '11:59', endTime: '15:00', laborUnits: 0.5 })).rejects.toThrow('重叠')
    await f.daywork({ startTime: '12:00', endTime: '17:00', laborUnits: 0.5 })
    await expect(f.daywork({ startTime: '17:00', endTime: '18:00', laborUnits: 0.5 })).rejects.toThrow('超过')
    expect(await f.db.select('SELECT id FROM signed_daywork_records')).toHaveLength(2)
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts')).toHaveLength(2)
  }
  finally { await f.close() }
})

it.each([
  { label: '非真实日期', patch: { workDate: '2026-02-30' }, reason: '签工日期必须是真实日期' },
  { label: '结束早于开始（跨日）', patch: { startTime: '17:00', endTime: '08:00' }, reason: '结束时间须晚于开始时间，且在同一日' },
  { label: '用工数为 0', patch: { laborUnits: 0 }, reason: '用工数只允许整工 1 或半工 0.5' },
  { label: '施工内容为空白', patch: { workContent: '  ' }, reason: '必须填写施工内容' },
  { label: '确认缺证明人', patch: { status: 'confirmed' as const, witness: '', confirmedOn: '2026-08-01' }, reason: '人工确认必须填写证明人' },
  { label: '确认日期早于签工日期', patch: { status: 'confirmed' as const, witness: '甲', confirmedOn: '2026-07-31' }, reason: '确认日期须为真实日期且不能早于签工日期' },
])('签工拒绝$label，原同键正文不得换用', async ({ patch, reason }) => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await expect(f.daywork(patch)).rejects.toThrow(reason)
    expect(await f.db.select('SELECT id FROM signed_daywork_records')).toHaveLength(0)
    const command = f.dayworkCommand(await f.dayworkForm(), { kind: 'save-daywork', record: f.record })
    const result = await f.service.executeDaywork(command)
    await expect(f.service.executeDaywork({ ...command, action: { kind: 'save-daywork', record: { ...f.record, note: '另一个正文' } } })).rejects.toThrow('编号')
    expect(await f.service.executeDaywork(command)).toEqual(result)
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts')).toHaveLength(1)
  }
  finally { await f.close() }
})

describe('c2 确认发放', () => {
  let f: Awaited<ReturnType<typeof createPayrollC2ServiceFixture>>
  let checked: Awaited<ReturnType<typeof createCheckedPayrollC2>>
  beforeAll(async () => {
    f = await createPayrollC2ServiceFixture()
    await f.daywork({ workerId: 'zero', workDate: '2026-08-03' })
    const empty = await f.c2Form()
    expect(empty.eligibility.canSaveDraft).toBe(false)
    await expect(f.service.executeC2(f.c2Command(empty, { kind: 'save-c2-draft', draft: f.draft }))).rejects.toThrow('该项目负责人尚无唯一有效 C2 主体配置')
    checked = await createCheckedPayrollC2(f)
    // 350 元/工 ×（整工 1 + 半工 0.5）
    expect(checked.totals.grossAmount.value).toBe(525)
  })
  afterAll(() => f.close())
  const exact = (actualAmount: number) => ({ actualAmount, allocations: [{ workerId: 'w', amount: actualAmount }, { workerId: 'member', amount: 0 }, { workerId: 'zero', amount: 0 }] })
  const overOrZero = 'C2 须核对完整，实际金额须到分且不超过当月核算；零额仅适用于明确启动并完整抵扣的空鼓处理'

  // subcontract-payroll.md 规则 8、10：超额、零额、分配不完整均禁止发放，且不留下任何发放痕迹。
  it.each([
    { label: '实发金额不到分', release: { actualAmount: 500.001, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }, reason: '金额须为到分数值，签工工数与主体单价须为有限数值或明确空值' },
    { label: '实发超过当月核算', release: { actualAmount: 526, allocations: [{ workerId: 'w', amount: 376 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }, reason: 'C2 须核对完整，实际金额须到分且不超过当月核算；零额仅适用于明确启动并完整抵扣的空鼓处理' },
    { label: '漏填成员', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }] }, reason: '组内分配必须包含负责人和全部成员，未分配成员请填 0' },
    { label: '成员分配为空值', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: null }] }, reason: '全体成员须明确实际分配，零分配也要填写 0' },
    { label: '分配合计不等于实发', release: { actualAmount: 499, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }, reason: '成员分配合计必须等于实际发放金额' },
    { label: '实发超过当月核算 0.01', release: exact(525.01), reason: overOrZero },
    { label: '无空鼓抵扣的零额发放', release: exact(0), reason: overOrZero },
  ])('拒绝$label', async ({ release, reason }) => {
    await expect(f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release }))).rejects.toThrow(reason)
    expect((await f.service.c2Form({ origin: 'real' }, { statementId: checked.statementId! })).status).toBe('checked')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-c2\'')).toHaveLength(0)
    expect(await f.db.select('SELECT id FROM wage_statement_allocations')).toHaveLength(0)
  })

  it('实发恰好等于当月核算可以发放', async () => {
    expect((await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: exact(525) }))).outcome).toBe('released')
  })
})
