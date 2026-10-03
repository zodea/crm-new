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

it.each(Array.from([{ workDate: '2026-02-30' }, { startTime: '17:00', endTime: '08:00' }, { laborUnits: 0 }, { workContent: '  ' }, { status: 'confirmed' as const, witness: '', confirmedOn: '2026-08-01' }, { status: 'confirmed' as const, witness: '甲', confirmedOn: '2026-07-31' }]).map(input1 => ({ input1 })))('签工拒绝无效日期、跨日、空证明与提前确认，原同键正文不得换用：输入案例 %#', async ({ input1: patch }) => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await expect(f.daywork(patch)).rejects.toThrow()
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
  { actualAmount: 500.001, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] },
  { actualAmount: 526, allocations: [{ workerId: 'w', amount: 376 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] },
  { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }] },
  { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: null }] },
  { actualAmount: 499, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] },
])('c2 实发拒绝不精确、越额或不完整分配：%#', async (release) => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.daywork({ workerId: 'zero', workDate: '2026-08-03' })
    const empty = await f.c2Form()
    expect(empty.eligibility.canSaveDraft).toBe(false)
    await expect(f.service.executeC2(f.c2Command(empty, { kind: 'save-c2-draft', draft: f.draft }))).rejects.toThrow()
    const checked = await createCheckedPayrollC2(f)
    await expect(f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release }))).rejects.toThrow()
    expect((await f.service.c2Form({ origin: 'real' }, { statementId: checked.statementId! })).status).toBe('checked')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-c2\'')).toHaveLength(0)
    expect(await f.db.select('SELECT id FROM wage_statement_allocations')).toHaveLength(0)
  }
  finally { await f.close() }
})
