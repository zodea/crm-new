// @vitest-environment jsdom
import type { PayrollHollowCommand, PayrollHollowConfigRead } from '~/lib/payroll/central-hollow-deduction-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePayrollHollowStore } from '~/stores/payroll-hollow'

const scope = { formatFamily: 'A' as const, projectId: 'project', crewId: null, leaderWorkerId: 'worker', book: { bookPurpose: 'ordinary' as const, managementBookId: null } }
const config = { scope, month: '2026-09' }
const context = { workspaceId: 'workspace', actorId: 'actor', origin: 'real' as const, sourceVersion: 'v1', readonly: false, capabilities: ['payroll:read', 'payroll:write'] }
const policy = { policyId: null, baseRevisionId: null, itemId: 'item', enabled: true, unitAmount: 30, effectiveMonth: '2026-09' }
const repository = { hollowConfig: vi.fn(), executeHollow: vi.fn() }
const identity = vi.fn()
const read = (): PayrollHollowConfigRead => ({ context: structuredClone(context), query: structuredClone(config), policies: [{ itemId: 'item', itemName: '墙砖', enabled: false, unitAmount: 30, source: 'default', revisionId: null, sourceVersion: 'v1' }], revisions: [], eligibility: { canSave: true, reasons: [] }, reasons: [] })
function result(command: PayrollHollowCommand) {
  return { commandId: command.commandId, projectId: 'project', statementId: null, startId: null, policyRevisionIds: ['revision'], sourceVersion: 'v2', outcome: 'saved' as const, logIds: ['log'] }
}
function confirmed(command: PayrollHollowCommand) {
  const value = read()
  value.context.sourceVersion = 'v2'
  value.revisions = [{ id: 'revision', policyId: 'policy', itemId: 'item', enabled: true, unitAmount: 30, effectiveMonth: '2026-09', scope: structuredClone(scope), previousRevisionId: null, commandId: command.commandId, createdBy: 'actor', createdAt: '2026-09-15T00:00:00Z' }]
  return value
}
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  identity.mockResolvedValue(structuredClone(context))
  repository.hollowConfig.mockImplementation(async () => read())
  repository.executeHollow.mockImplementation(async command => result(command))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repository, projectCommands: { context: identity } } }))
})
afterEach(() => vi.unstubAllGlobals())

it('扣款配置未知回复冷重建仍保原编号、开关、明确零和生效月份', async () => {
  let store = usePayrollHollowStore()
  const value = await store.loadConfig({ origin: 'real' }, config)
  repository.executeHollow.mockRejectedValueOnce(new Error('回复丢失'))
  await expect(store.savePolicies(value, [{ ...policy, unitAmount: 0 }])).rejects.toThrow('回复丢失')
  const original = store.getPending(value)!
  setActivePinia(createPinia())
  store = usePayrollHollowStore()
  const later = await store.loadConfig({ origin: 'real' }, config)
  expect(store.getPending(later)).toEqual(original)
  await store.recover(original)
  expect(repository.executeHollow.mock.calls.at(-1)![0]).toEqual(original.command)
  expect(store.getPending(later)?.state).toBe('awaiting-read')
})

it('只有可信提交后原修订读能清原配置，伪造读与提交前迟到读均无效', async () => {
  const store = usePayrollHollowStore()
  const value = await store.loadConfig({ origin: 'real' }, config)
  let resolve!: (read: PayrollHollowConfigRead) => void
  repository.hollowConfig.mockImplementationOnce(() => new Promise(done => resolve = done))
  const early = store.loadConfig({ origin: 'real' }, config)
  await store.savePolicies(value, [policy])
  const original = store.getPending(value)!
  const response = confirmed(original.command)
  resolve(response)
  expect(() => store.acknowledge(original, structuredClone(response))).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  expect(() => store.acknowledge(original, response)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  await early
  expect(() => store.acknowledge(original, response)).toThrow('原目标尚未完整读取确认，请保留原输入并重试核对')
  repository.hollowConfig.mockResolvedValueOnce(structuredClone(response))
  const fresh = await store.loadConfig({ origin: 'real' }, config)
  store.acknowledge(original, fresh)
  expect(store.getPending(fresh)).toBeNull()
})

it('重新核对先验证当前身份及写权，撤权不能重放但不清原稿', async () => {
  const store = usePayrollHollowStore()
  const value = await store.loadConfig({ origin: 'real' }, config)
  repository.executeHollow.mockRejectedValueOnce(new Error('回复丢失'))
  await expect(store.savePolicies(value, [policy])).rejects.toThrow('回复丢失')
  const original = store.getPending(value)!
  identity.mockResolvedValueOnce({ ...context, actorId: 'other' })
  await expect(store.recover(original)).rejects.toThrow('当前身份或权限不能处理这份原空鼓扣款提交')
  identity.mockResolvedValueOnce({ ...context, capabilities: ['payroll:read'] })
  await expect(store.recover(original)).rejects.toThrow('当前身份或权限不能处理这份原空鼓扣款提交')
  expect(repository.executeHollow).toHaveBeenCalledTimes(1)
  expect(store.getPending(value)).toEqual(original)
})
