import { expect, it } from 'vitest'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

it('c2主体按项目与负责人保存正价和明确空规则，不要求月份或工程量，原配置可冷读', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const read = await f.c2Config()
    expect(read).toMatchObject({ scope: { projectId: 'p', leaderWorkerId: 'w' }, config: null, draft: { unitRate: null, ruleText: '' } })
    const command = f.c2Command(read, { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } })
    const saved = await f.service.executeC2(command)
    expect(saved).toMatchObject({ outcome: 'saved', statementId: null, dayworkRecordIds: [], dayworkLinkIds: [] })
    expect((await f.c2Config()).config).toMatchObject({ id: saved.configId, unitRate: 350, ruleText: '', enabled: true })
    expect(await f.service.executeC2(command)).toEqual(saved)
    await expect(f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 0, ruleText: '' } }))).rejects.toThrow('正')
  }
  finally { await f.close() }
})

it('核算525实际500与350/150/0全成员同时发放，原命令重试唯一，冷读配对冻结不取当前改名改价', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const read = await createCheckedPayrollC2(f)
    const release = { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] }
    const command = f.c2Command(read, { kind: 'release-c2', release })
    const result = await f.service.executeC2(command)
    expect(result.outcome).toBe('released')
    expect(await f.service.executeC2(command)).toEqual(result)
    const first = await f.service.c2Output({ origin: 'real' }, result.statementId!)
    expect(first).toMatchObject({ state: 'available', document: { formatFamily: 'C2', grossAmount: 525, actualAmount: 500, config: { unitRate: 350, ruleText: '' } } })
    if (first.state !== 'available')
      throw new Error('真实发放应有完整冻结')
    expect(first.document.daywork).toHaveLength(2)
    expect(first.document.allocations.map(a => a.amount)).toEqual([350, 150, 0])
    f.source.workers[0]!.name = '以后改名'
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 360, ruleText: '后续规则' } }))
    expect((await f.service.c2Output({ origin: 'real' }, result.statementId!)).document).toEqual(first.document)
    await expect(f.daywork({ workerId: 'zero', workDate: '2026-08-31' })).rejects.toThrow('已发')
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-c2\'')).toHaveLength(1)
  }
  finally { await f.close() }
})

it('逐条confirmed签工按主体价核算525，保存核对保唯一关联及没有签工的零成员', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await f.service.executeC2(f.c2Command(await f.c2Config(), { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 350, ruleText: '' } }))
    const one = await f.daywork({ status: 'confirmed', witness: '证明甲', confirmedOn: '2026-08-02' })
    const half = await f.daywork({ workerId: 'member', laborUnits: 0.5, endTime: '12:00', status: 'confirmed', witness: '证明乙', confirmedOn: '2026-08-02' })
    await f.daywork({ workerId: 'member', workDate: '2026-08-03', laborUnits: 0.5, endTime: '12:00' })
    const preview = await f.c2Form()
    expect(preview.totals.grossAmount).toMatchObject({ state: 'known', value: 525 })
    expect(preview.adoptedRecordIds.sort()).toEqual([one.recordId, half.recordId].sort())
    expect(preview.facts.filter(r => r.availability === 'pending')).toHaveLength(1)
    const saved = await f.service.executeC2(f.c2Command(preview, { kind: 'save-c2-draft', draft: f.draft }))
    expect(saved.dayworkRecordIds.sort()).toEqual([one.recordId, half.recordId].sort())
    const read = await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    const checked = await f.service.executeC2(f.c2Command(read, { kind: 'check-c2' }))
    expect(checked.outcome).toBe('checked')
    const fresh = await f.service.c2Form({ origin: 'real' }, { statementId: saved.statementId! })
    expect(fresh).toMatchObject({ status: 'checked', needsRecheck: false, eligibility: { canRelease: true } })
    expect(fresh.members.map(m => m.id)).toEqual(['w', 'member', 'zero'])
    expect(fresh.lines.map(l => l.amount).sort()).toEqual([175, 350])
    expect(await f.db.select('SELECT id FROM wage_statement_daywork_records WHERE deleted_at IS NULL')).toHaveLength(2)
    expect(await f.db.select('SELECT id FROM wage_statement_daywork_records WHERE deleted_at IS NOT NULL')).toHaveLength(2)
  }
  finally { await f.close() }
})
