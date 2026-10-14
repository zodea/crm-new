// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePayrollC2Store } from '~/stores/payroll-c2'
import { createCheckedPayrollC2, createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => vi.unstubAllGlobals())
it('真实C2发放丢响应冷实例按原键恢复，只有原表单与available冻结的可信后读能解除', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const checked = await createCheckedPayrollC2(f)
    const repo = { ...f.service, executeC2: vi.fn(f.service.executeC2), c2Output: vi.fn(f.service.c2Output) }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
    const store = usePayrollC2Store()
    const read = await store.loadC2Form({ origin: 'real' }, { statementId: checked.statementId! })
    repo.executeC2.mockImplementationOnce(async (command) => {
      await f.service.executeC2(command)
      throw new Error('成功响应丢失')
    })
    await expect(store.releaseC2(read, { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] })).rejects.toThrow('成功响应丢失')
    const original = store.getC2Pending(read)!
    expect(original.state).toBe('unknown')
    setActivePinia(createPinia())
    const cold = usePayrollC2Store()
    await cold.recoverC2(original)
    expect(repo.executeC2.mock.calls.at(-1)![0]).toEqual(original.command)
    expect(cold.getC2Pending(read)?.state).toBe('awaiting-read')
    expect(() => cold.acknowledgeC2(original, read)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
    const refreshed = await cold.loadC2Form({ origin: 'real' }, { statementId: checked.statementId! })
    expect(() => cold.acknowledgeC2(original, refreshed)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
    repo.c2Output.mockRejectedValueOnce(new Error('冻结后读断线'))
    await expect(cold.loadC2Output({ origin: 'real' }, checked.statementId!)).rejects.toThrow('冻结后读断线')
    expect(cold.getC2Pending(read)?.command).toEqual(original.command)
    const output = await cold.loadC2Output({ origin: 'real' }, checked.statementId!)
    cold.acknowledgeC2(original, refreshed, output)
    expect(cold.getC2Pending(read)).toBeNull()
    expect(await f.db.select('SELECT command_id FROM payroll_command_receipts WHERE action=\'release-c2\'')).toHaveLength(1)
  }
  finally { await f.close() }
})

it('主体配置按项目负责人原键恢复，其他负责人和预提交读取不能确认成功', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: f.service } }))
    const store = usePayrollC2Store()
    const read = await store.loadC2Config({ origin: 'real' }, { projectId: 'p', leaderWorkerId: 'w' })
    const result = await store.saveC2Config(read, { crewId: 'crew', unitRate: 350.125, ruleText: '' })
    const original = store.getC2Pending(read)!
    expect(() => store.acknowledgeC2(original, read)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
    const wrong = await store.loadC2Config({ origin: 'real' }, { projectId: 'p', leaderWorkerId: 'member' })
    expect(() => store.acknowledgeC2(original, wrong)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
    const latest = await store.loadC2Config({ origin: 'real' }, read.scope)
    expect(latest.config?.id).toBe(result.configId)
    store.acknowledgeC2(original, latest)
    expect(store.getC2Pending(read)).toBeNull()
  }
  finally { await f.close() }
})

it('原命令已可靠返回需重核后，其他窗口再次核对仍可按原单确认成功而不永久卡住', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const checked = await createCheckedPayrollC2(f)
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: f.service } }))
    const store = usePayrollC2Store()
    const read = await store.loadC2Form({ origin: 'real' }, { statementId: checked.statementId! })
    const record = read.facts[0]!
    const originalRecord = await f.service.dayworkForm({ origin: 'real' }, { recordId: record.id })
    await f.service.executeDaywork(f.dayworkCommand(originalRecord, { kind: 'save-daywork', record: { ...f.record, workerId: record.workerId, laborUnits: record.laborUnits, endTime: record.endTime!, status: 'confirmed', witness: '后续人工证明', confirmedOn: '2026-08-03' } }))
    const result = await store.releaseC2(read, { actualAmount: 500, allocations: [{ workerId: 'w', amount: 350 }, { workerId: 'member', amount: 150 }, { workerId: 'zero', amount: 0 }] })
    expect(result.outcome).toBe('needs-recheck')
    const original = store.getC2Pending(read)!
    const newer = await f.service.c2Form({ origin: 'real' }, { statementId: result.statementId })
    await f.service.executeC2(f.c2Command(newer, { kind: 'check-c2' }))
    const refreshed = await store.loadC2Form({ origin: 'real' }, { statementId: result.statementId })
    expect(refreshed.needsRecheck).toBe(false)
    store.acknowledgeC2(original, refreshed)
    expect(store.getC2Pending(read)).toBeNull()
  }
  finally { await f.close() }
})
