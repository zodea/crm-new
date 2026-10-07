import { expect, it } from 'vitest'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

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

it.each([
  { label: '实发金额不到分', release: { actualAmount: 500.001, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }, reason: '金额须为到分数值，签工工数与主体单价须为有限数值或明确空值' },
  { label: '实发超过当月核算', release: { actualAmount: 526, allocations: [{ workerId: 'w', amount: 376 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }, reason: 'C2 须核对完整，实际金额须到分且不超过当月核算；零额仅适用于明确启动并完整抵扣的空鼓处理' },
  { label: '漏填成员', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }] }, reason: '组内分配必须包含负责人和全部成员，未分配成员请填 0' },
  { label: '成员分配为空值', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: null }] }, reason: '全体成员须明确实际分配，零分配也要填写 0' },
  { label: '分配合计不等于实发', release: { actualAmount: 499, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }, reason: '成员分配合计必须等于实际发放金额' },
])('c2 实发拒绝$label', async ({ release, reason }) => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.daywork({ workerId: 'zero', workDate: '2026-08-03' })
    const empty = await f.c2Form()
    expect(empty.eligibility.canSaveDraft).toBe(false)
    await expect(f.service.executeC2(f.c2Command(empty, { kind: 'save-c2-draft', draft: f.draft }))).rejects.toThrow('该项目负责人尚无唯一有效 C2 主体配置')
    const checked = await createCheckedPayrollC2(f)
    await expect(f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release }))).rejects.toThrow(reason)
    expect((await f.service.c2Form({ origin: 'real' }, { statementId: checked.statementId! })).status).toBe('checked')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-c2\'')).toHaveLength(0)
    expect(await f.db.select('SELECT id FROM wage_statement_allocations')).toHaveLength(0)
  }
  finally { await f.close() }
})
