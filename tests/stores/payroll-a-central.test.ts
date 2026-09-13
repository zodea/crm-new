// @vitest-environment jsdom
import type { PayrollACommand, PayrollAFormRead } from '~/lib/payroll/central-a-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { payrollProblem } from '~/lib/payroll/central-contract'
import { usePayrollAStore } from '~/stores/payroll-a'

const repo = { aForm: vi.fn(), execute: vi.fn() }
function read(id: string | null = 'a', actor = 'actor'): PayrollAFormRead {
  return { context: { workspaceId: 'work', actorId: actor, origin: 'real', sourceVersion: 'read-original', readonly: false, capabilities: ['payroll:read', 'payroll:write'] }, statementId: id, draftKey: id ? null : 'new-a', status: 'draft', needsRecheck: false, draft: { projectId: 'p', month: '2026-08', leaderWorkerId: 'w', crewId: null, memberWorkerIds: ['w'], payRatio: 0.8, periodKind: 'monthly', note: '' }, options: { projects: [], workers: [], crews: [] }, members: [], facts: [], prices: [], lines: [], ratioDefault: { value: null, source: 'missing', statementId: null, configId: null, sourceVersion: null }, totals: Object.fromEntries(['workAmount', 'cumulativeAmount', 'previouslyPaid', 'grossAmount'].map(key => [key, { value: 0, knownValue: 0, state: 'known', reasons: [] }])) as PayrollAFormRead['totals'], paymentSourceVersion: 'payments', blockers: [], eligibility: { canSaveDraft: true, canCheck: true, canRelease: false, canOutput: false, reasons: [] } }
}
beforeEach(() => {
  sessionStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  repo.aForm.mockImplementation(async (_q, target) => read(target.statementId))
  repo.execute.mockImplementation(async (c: PayrollACommand) => ({ commandId: c.commandId, statementId: c.statementId ?? 'created', subjectConfigId: null, projectId: c.projectId, sourceVersion: 'new', priceRevisionIds: [], logIds: [], outcome: 'saved' }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('固定页面读不被另一读抬高基准，失响应保原身份/原金额/原键并冷恢复', async () => {
  const store = usePayrollAStore()
  const original = await store.loadAForm({ origin: 'real' }, { statementId: 'a' })
  await store.loadAForm({ origin: 'real' }, { statementId: 'b' })
  const allocation = { actualAmount: 10, allocations: [{ workerId: 'w', amount: 10 }] }
  repo.execute.mockRejectedValueOnce(new Error('响应丢失'))
  await expect(store.releaseA(original, allocation)).rejects.toThrow('响应丢失')
  const pending = store.getAPending(original)!
  allocation.actualAmount = 20
  expect(pending.command.action).toMatchObject({ release: { actualAmount: 10 } })
  expect(pending.command).toMatchObject({ statementId: 'a', sourceVersion: 'read-original' })
  expect(pending.command).not.toHaveProperty('capabilities')
  expect(store.getAPending(read('b'))).toBeNull()
  expect(store.getAPending(read('a', 'other'))).toBeNull()
  setActivePinia(createPinia())
  const restored = usePayrollAStore()
  expect(restored.getAPending(original)?.command).toEqual(pending.command)
  await restored.recoverA(restored.getAPending(original)!)
  expect(repo.execute.mock.calls.at(-1)![0]).toEqual(pending.command)
  expect(restored.getAPending(original)).toBeNull()
})
it('只有本命令明确未应用才释放，通用stale、撤权或损坏回读保原键', async () => {
  const store = usePayrollAStore()
  repo.execute.mockRejectedValueOnce(new Error('断线'))
  await expect(store.checkA(read())).rejects.toThrow()
  const pending = store.getAPending(read())!
  repo.execute.mockRejectedValueOnce(payrollProblem('stale-source', '回查失败'))
  await expect(store.recoverA(pending)).rejects.toThrow()
  expect(store.getAPending(read())?.command.commandId).toBe(pending.command.commandId)
  const absent = payrollProblem('validation-failed', '确实未写入')
  Object.assign(absent.problem, { commandId: pending.command.commandId, commandOutcome: 'not-applied' })
  repo.execute.mockRejectedValueOnce(absent)
  await expect(store.recoverA(pending)).rejects.toThrow()
  expect(store.getAPending(read())).toBeNull()
})
it('存储无法持久保存原提交时不发送且保留原输入', async () => {
  const store = usePayrollAStore()
  const original = read()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError')
  })
  await expect(store.checkA(original)).rejects.toThrow('尚未发送')
  expect(repo.execute).not.toHaveBeenCalled()
  expect(original.draft.payRatio).toBe(0.8)
})
