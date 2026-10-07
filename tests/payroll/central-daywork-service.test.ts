import { expect, it } from 'vitest'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

it.each(['', '2026-08'])('签工台账拒绝不存在的指定项目，核对月份 %s', async (month) => {
  const f = await createPayrollC2ServiceFixture()
  try {
    await expect(f.service.dayworkList({ origin: 'real' }, { ...f.scope, projectId: 'missing-project', month })).rejects.toMatchObject({ problem: { code: 'not-found' } })
  }
  finally { await f.close() }
})

it('当前项目退出候选后仍保留可追溯的原签工，不改读其他项目', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const saved = await f.daywork()
    f.source.projects = f.source.projects.filter(project => project.id !== 'p')
    const read = await f.ledger()
    expect(read.scope).toEqual(f.scope)
    expect(read.records).toMatchObject([{ id: saved.recordId, projectId: 'p', workerId: 'w', laborUnits: 1 }])
  }
  finally { await f.close() }
})

it.each([{ projectId: '', month: '', crewId: null }, { month: '', crewId: null }, {}])('直接用工项目可读签工候选，缺项范围保空台账：%j', async (patch) => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const scope = { ...f.scope, ...patch }
    const read = await f.service.dayworkList({ origin: 'real' }, scope)
    expect(read.scope).toEqual(scope)
    expect(read.records).toEqual([])
    expect(read.options.projects.map(p => p.id)).toEqual(['p', 'other-project'])
    expect(read.context.readonly).toBe(false)
    await expect(f.service.dayworkList({ origin: 'real' }, { ...f.scope, month: '2026-13' })).rejects.toThrow('签工范围无效')
    expect((await f.ledger()).options.workers.map(w => w.id)).toEqual(['w', 'member', 'zero', 'unknown'])
  }
  finally { await f.close() }
})

it('真实保存待确认原行后可人工确认，超过两天仍保一工并通过原编号读取', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const saved = await f.daywork()
    expect(saved).toMatchObject({ outcome: 'saved', status: 'draft', recordProjectId: 'p', workerId: 'w' })
    expect((await f.ledger()).records[0]).toMatchObject({ id: saved.recordId, laborUnits: 1, status: 'draft', availability: 'pending' })
    const read = await f.service.dayworkForm({ origin: 'real' }, { recordId: saved.recordId })
    const command = f.dayworkCommand(read, { kind: 'confirm-daywork', confirmation: { witness: '现场证明人', confirmedOn: '2026-08-10' } })
    const confirmed = await f.service.executeDaywork(command)
    expect(confirmed).toMatchObject({ recordId: saved.recordId, outcome: 'confirmed', status: 'confirmed' })
    expect(confirmed.recordFingerprint).not.toBe(saved.recordFingerprint)
    expect((await f.service.dayworkForm({ origin: 'real' }, { recordId: saved.recordId })).record).toMatchObject({ laborUnits: 1, witness: '现场证明人', confirmedOn: '2026-08-10', availability: 'available' })
    expect(await f.service.executeDaywork(command)).toEqual(confirmed)
    expect(await f.db.select('SELECT id FROM signed_daywork_records')).toHaveLength(1)
  }
  finally { await f.close() }
})

it.each([{ projectId: 'other-project' }, { month: '2026-09' }, { projectId: '' }, { month: '' }])('签工全成员月锁不跨项目月份或空范围：%j', async (patch) => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const checked = await createCheckedPayrollC2(f)
    await f.service.executeC2(f.c2Command(checked, { kind: 'release-c2', release: { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] } }))
    const scope = { ...f.scope, ...patch }
    const scopedRead = await f.service.dayworkList({ origin: 'real' }, scope)
    expect(scopedRead.locks).toEqual([])
    expect(scopedRead.records).toEqual([])
    const read = await f.ledger()
    expect(read.locks.every(lock => lock.projectId === 'p' && lock.month === '2026-08')).toBe(true)
    expect(read.records.map(record => record.workerId).sort()).toEqual(['member', 'w'])
    expect(await f.db.select('SELECT id FROM signed_daywork_records WHERE worker_id=?', ['zero'])).toHaveLength(0)
  }
  finally { await f.close() }
})
