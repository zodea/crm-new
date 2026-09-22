// @vitest-environment jsdom
import type { PayrollC1Command, PayrollC1ConfigRead, PayrollC1FormRead, PayrollC1OutputRead } from '~/lib/payroll/central-c1-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollC1Store } from '~/stores/payroll-c1'
import { c1Frozen } from '../helpers/payroll-c1-ui'

const repo = { c1Form: vi.fn(), c1Config: vi.fn(), c1Output: vi.fn(), executeC1: vi.fn() }
function read(id = 'c1', actor = 'actor'): PayrollC1FormRead {
  return { context: { workspaceId: 'work', actorId: actor, origin: 'real', sourceVersion: 'original', readonly: false, capabilities: ['payroll:read', 'payroll:write'] }, statementId: id, draftKey: null, status: 'checked', needsRecheck: false, draft: { projectId: 'p', crewId: 'crew', leaderWorkerId: 'w', memberWorkerIds: ['w'], month: '2026-08', note: '' }, options: { projects: [], crews: [], workers: [] }, members: [], facts: [], sources: [], rates: [], lines: [], totals: { grossAmount: { value: 10, knownValue: 10, state: 'known', reasons: [] } }, blockers: [], eligibility: { canSaveDraft: false, canCheck: true, canRelease: true, canOutput: false, reasons: [] } }
}
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  repo.c1Form.mockImplementation(async (_q, target) => ({ ...read(target.statementId), status: repo.executeC1.mock.calls.some(([c]) => c.statementId === target.statementId && c.action.kind === 'release-c1') ? 'released' : 'checked' }))
  repo.executeC1.mockImplementation(async (c: PayrollC1Command) => ({ commandId: c.commandId, projectId: c.projectId, statementId: c.action.kind === 'save-c1-rates' ? null : c.statementId ?? 'created-c1', rateRevisionIds: [], sourceVersion: 'next', outcome: c.action.kind === 'release-c1' ? 'released' : c.action.kind === 'check-c1' ? 'checked' : 'saved', logIds: [] }))
  repo.c1Output.mockImplementation(async (_q, id): Promise<PayrollC1OutputRead> => ({ context: read(id).context, statementId: id, state: 'available', document: { ...c1Frozen(), id }, reasons: [] }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('c1 原金额原键在丢响应、换单和冷恢复期间固定，不与 A 存储桶混用', async () => {
  sessionStorage.setItem('payroll-a-central-pending-v1', '{"original-a":{"commandId":"a"}}')
  const store = usePayrollC1Store()
  const form = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  const release = { actualAmount: 10, allocations: [{ workerId: 'w', amount: 10 }] }
  repo.executeC1.mockRejectedValueOnce(new Error('响应丢失'))
  await expect(store.releaseC1(form, release)).rejects.toThrow()
  release.actualAmount = 20
  const pending = store.getC1Pending(form)!
  expect(pending.command.action).toMatchObject({ release: { actualAmount: 10 } })
  expect(store.getC1Pending(read('other'))).toBeNull()
  expect(store.getC1Pending(read('c1', 'other'))).toBeNull()
  setActivePinia(createPinia())
  const restored = usePayrollC1Store()
  await restored.recoverC1(restored.getC1Pending(form)!)
  expect(repo.executeC1.mock.calls.at(-1)![0]).toEqual(pending.command)
  expect(restored.getC1Pending(form)?.state).toBe('awaiting-read')
  const refreshed = await restored.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  const output = await restored.loadC1Output({ origin: 'real' }, 'c1')
  restored.acknowledgeC1(pending, refreshed, output)
  expect(restored.getC1Pending(form)).toBeNull()
  expect(sessionStorage.getItem('payroll-a-central-pending-v1')).toBe('{"original-a":{"commandId":"a"}}')
})
it('成功回执保原稿到同目标完整冷读，旧读、他人、其他单据和未读输出不能解除', async () => {
  const store = usePayrollC1Store()
  const old = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  await store.releaseC1(old, { actualAmount: 10, allocations: [{ workerId: 'w', amount: 10 }] })
  const pending = store.getC1Pending(old)!
  expect(pending.state).toBe('awaiting-read')
  expect(() => store.acknowledgeC1(pending, old)).toThrow()
  const other = await store.loadC1Form({ origin: 'real' }, { statementId: 'other' })
  expect(() => store.acknowledgeC1(pending, other)).toThrow()
  repo.c1Form.mockResolvedValueOnce(read('c1', 'other'))
  const foreign = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  expect(() => store.acknowledgeC1(pending, foreign)).toThrow()
  const refreshed = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  expect(() => store.acknowledgeC1(pending, refreshed)).toThrow()
  repo.c1Output.mockRejectedValueOnce(new Error('冻结输出断线'))
  await expect(store.loadC1Output({ origin: 'real' }, 'c1')).rejects.toThrow()
  expect(store.getC1Pending(old)?.command).toEqual(pending.command)
  const output = await store.loadC1Output({ origin: 'real' }, 'c1')
  store.acknowledgeC1(pending, refreshed, output)
  expect(store.getC1Pending(old)).toBeNull()
})
it('命令前已开始的读不算后读，撤权和本地改动读内容均保留原提交', async () => {
  const store = usePayrollC1Store()
  let resolve!: (value: PayrollC1FormRead) => void
  repo.c1Form.mockImplementationOnce(() => new Promise<PayrollC1FormRead>(done => resolve = done))
  const inflight = store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  await store.checkC1(read())
  const pending = store.getC1Pending(read())!
  resolve(read())
  const awaitRead = await inflight
  expect(() => store.acknowledgeC1(pending, awaitRead)).toThrow()
  repo.c1Form.mockResolvedValueOnce({ ...read(), context: { ...read().context, readonly: true, capabilities: ['payroll:read'] } })
  const revoked = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  expect(() => store.acknowledgeC1(pending, revoked)).toThrow()
  const changed = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  changed.draft.note = '本地改成其他证据'
  expect(() => store.acknowledgeC1(pending, changed)).toThrow()
  const preview = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1', draft: { note: '仍是预览，不是已存原单冷读' } })
  expect(() => store.acknowledgeC1(pending, preview)).toThrow()
  expect(store.getC1Pending(read())?.command).toEqual(pending.command)
  const refreshed = await store.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  store.acknowledgeC1(pending, refreshed)
  expect(store.getC1Pending(read())).toBeNull()
})
it('回执保存或最终确认的存储故障保命令，恢复仍发送原编号；可靠成功不会被矛盾未应用回执解除', async () => {
  const store = usePayrollC1Store()
  const storageWrite = Storage.prototype.setItem
  repo.executeC1.mockImplementationOnce(async (command: PayrollC1Command) => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('回执存储失效')
    })
    return { commandId: command.commandId, projectId: 'p', statementId: 'c1', rateRevisionIds: [], sourceVersion: 'next', outcome: 'checked', logIds: [] }
  })
  await expect(store.checkC1(read())).rejects.toThrow('保留输入')
  const original = store.getC1Pending(read())!
  expect(original.state).toBe('unknown')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(storageWrite)
  setActivePinia(createPinia())
  const cold = usePayrollC1Store()
  await cold.recoverC1(original)
  expect(repo.executeC1.mock.calls.at(-1)![0]).toEqual(original.command)
  expect(cold.getC1Pending(read())?.state).toBe('awaiting-read')
  const absent = payrollProblem('stale-source', '矛盾的未应用回执')
  Object.assign(absent.problem, { commandId: original.command.commandId, commandOutcome: 'not-applied' })
  repo.executeC1.mockRejectedValueOnce(absent)
  await expect(cold.recoverC1(original)).rejects.toThrow()
  expect(cold.getC1Pending(read())?.state).toBe('awaiting-read')
  const refreshed = await cold.loadC1Form({ origin: 'real' }, { statementId: 'c1' })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('确认存储失效')
  })
  expect(() => cold.acknowledgeC1(original, refreshed)).toThrow('保留输入')
  expect(cold.getC1Pending(read())?.command).toEqual(original.command)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(storageWrite)
  cold.acknowledgeC1(original, refreshed)
  expect(cold.getC1Pending(read())).toBeNull()
})
it('新建按原 draftKey 保管成功回执，冷实例读取真实新单号才确认', async () => {
  const store = usePayrollC1Store()
  const original = { ...read(), statementId: null, draftKey: 'original-draft' }
  await store.saveC1Draft(original, { projectId: 'p', crewId: 'crew', leaderWorkerId: 'w', memberWorkerIds: ['w'], month: '2026-08', note: '完整草稿' })
  const pending = store.getC1Pending(original)!
  setActivePinia(createPinia())
  const cold = usePayrollC1Store()
  expect(cold.getC1Pending(original)).toEqual(pending)
  const wrong = await cold.loadC1Form({ origin: 'real' }, { statementId: 'other' })
  expect(() => cold.acknowledgeC1(pending, wrong)).toThrow()
  const refreshed = await cold.loadC1Form({ origin: 'real' }, { statementId: 'created-c1' })
  cold.acknowledgeC1(pending, refreshed)
  expect(cold.getC1Pending(original)).toBeNull()
  expect(repo.executeC1).toHaveBeenCalledTimes(1)
})
it('配置确认只接受原项目月份班组的冷读，成功回执不清零值原输入', async () => {
  const config: PayrollC1ConfigRead = { context: read().context, scope: { projectId: 'p', month: '2026-08', crewId: 'crew' }, options: read().options, rates: [], readonlyReasons: [], history: [] }
  repo.c1Config.mockImplementation(async (_q, scope) => ({ ...config, scope }))
  const store = usePayrollC1Store()
  await store.saveC1Rates(config, [{ workerId: 'w', dailyWage: 0, overtimeRate: null }])
  const pending = store.getC1Pending(config)!
  expect(pending.command.action).toMatchObject({ rates: [{ dailyWage: 0, overtimeRate: null }] })
  const other = await store.loadC1Config({ origin: 'real' }, { ...config.scope, month: '2026-09' })
  expect(() => store.acknowledgeC1(pending, other)).toThrow()
  const refreshed = await store.loadC1Config({ origin: 'real' }, config.scope)
  store.acknowledgeC1(pending, refreshed)
  expect(store.getC1Pending(config)).toBeNull()
})
it('拒权与不明错误保留原键，只有原命令明确未应用才释放，存储故障不发送', async () => {
  const store = usePayrollC1Store()
  repo.executeC1.mockRejectedValueOnce(payrollProblem('forbidden', '权限撤销'))
  await expect(store.checkC1(read())).rejects.toThrow()
  const pending = store.getC1Pending(read())!
  const absent = payrollProblem('stale-source', '确认未应用')
  Object.assign(absent.problem, { commandId: pending.command.commandId, commandOutcome: 'not-applied' })
  repo.executeC1.mockRejectedValueOnce(absent)
  await expect(store.recoverC1(pending)).rejects.toThrow()
  expect(store.getC1Pending(read())).toBeNull()
  const count = repo.executeC1.mock.calls.length
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('不可写')
  })
  await expect(store.checkC1(read())).rejects.toThrow('尚未发送')
  expect(repo.executeC1).toHaveBeenCalledTimes(count)
})
