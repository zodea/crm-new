// @vitest-environment jsdom
import type { QuantityHollowCommand, QuantityHollowRead } from '../../app/lib/quantity/central-hollow-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useProductionAccessStore } from '~/stores/production-access'
import { useQuantityHollowStore } from '~/stores/quantity-hollow'
import { hollowIdentity, hollowInput, hollowQuery, hollowRead, hollowRecord, hollowResult, hollowTarget } from '../helpers/quantity-hollow-ui-fixture'

const repository = { hollow: vi.fn(), execute: vi.fn(), resolve: vi.fn() }
const context = vi.fn()
const create = { kind: 'create-hollow-inspection' as const, target: hollowTarget, input: hollowInput }
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  context.mockResolvedValue(structuredClone(hollowIdentity))
  repository.hollow.mockImplementation(async () => hollowRead())
  repository.execute.mockImplementation(async command => hollowResult(command))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { quantity: repository, projectCommands: { context }, productionAccess: { status: async () => ({ mode: 'production', authenticated: true, ...hollowIdentity }) } } }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('响应丢失冷恢复保原键原正文，后来版本不能覆盖原提交', async () => {
  let store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  repository.execute.mockRejectedValueOnce(new Error('响应丢失'))
  await expect(store.submit(read, create)).rejects.toThrow('响应丢失')
  const original = store.getPending(read)!
  expect(original.state).toBe('unknown')
  setActivePinia(createPinia())
  store = useQuantityHollowStore()
  repository.hollow.mockResolvedValueOnce(hollowRead([], 'quantity-newer'))
  const newer = await store.load(hollowQuery)
  expect(store.getPending(newer)).toEqual(original)
  await expect(store.submit(newer, { ...create, input: { ...hollowInput, count: 30 } })).rejects.toThrow('请先核对原空鼓提交')
  await store.recover(original)
  expect(repository.execute.mock.calls.at(-1)![0]).toEqual(original.command)
  expect(store.getPending(newer)?.state).toBe('awaiting-read')
})

it('成功回执只能由可信同目标后读核实，历史原修订不必仍为最新', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  await store.submit(read, create)
  const original = store.getPending(read)!
  expect(() => store.acknowledge(original, read)).toThrow('原空鼓记录尚未完整读取确认')
  const missing = await store.load(hollowQuery)
  expect(() => store.acknowledge(original, missing)).toThrow('原空鼓记录尚未完整读取确认')
  const record = hollowRecord(original.command)
  const later = { ...record.inspection, revisionId: 'revision-later', previousRevisionId: 'revision', commandId: 'later-command', logId: 'later-log', reason: '后来复查', input: { ...hollowInput, count: 20 } }
  record.revisions.push(later)
  record.inspection = later
  record.remainingCount = 20
  record.proof = { ...record.proof, revisionId: later.revisionId, headLogId: later.logId }
  const response = hollowRead([record], 'quantity-v3')
  expect(() => store.acknowledge(original, response)).toThrow('原空鼓记录尚未完整读取确认')
  repository.hollow.mockResolvedValueOnce(response)
  const fresh = await store.load(hollowQuery)
  store.acknowledge(original, fresh)
  expect(store.getPending(fresh)).toBeNull()
})

it('提交前启动的迟到读取不能冒充提交后核对', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  let finish!: (value: QuantityHollowRead) => void
  repository.hollow.mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  const earlier = store.load(hollowQuery)
  await store.submit(read, create)
  const original = store.getPending(read)!
  finish(hollowRead([hollowRecord(original.command)], 'quantity-v2'))
  const late = await earlier
  expect(() => store.acknowledge(original, late)).toThrow('原空鼓记录尚未完整读取确认')
  expect(store.getPending(read)?.state).toBe('awaiting-read')
})

it('重新读取失败不清回执，改正文的伪造后读不能解除等待', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  await store.submit(read, create)
  const original = store.getPending(read)!
  repository.hollow.mockRejectedValueOnce(new Error('读失败'))
  await expect(store.load(hollowQuery)).rejects.toThrow('读失败')
  expect(store.getPending(read)?.state).toBe('awaiting-read')
  repository.hollow.mockResolvedValueOnce(hollowRead([hollowRecord(original.command)], 'quantity-v2'))
  const fresh = await store.load(hollowQuery)
  fresh.data.records[0]!.originalPartyName = '伪造的姓名'
  expect(() => store.acknowledge(original, fresh)).toThrow('原空鼓记录尚未完整读取确认')
})

it('当前身份变化或撤权不能重放原提交，原正文仍可供原身份恢复', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  repository.execute.mockRejectedValueOnce(new Error('响应丢失'))
  await expect(store.submit(read, create)).rejects.toThrow('响应丢失')
  const original = store.getPending(read)!
  context.mockResolvedValueOnce({ ...hollowIdentity, actorId: 'other-actor' })
  await expect(store.recover(original)).rejects.toThrow('当前身份不能核对')
  context.mockResolvedValueOnce({ ...hollowIdentity, capabilities: ['quantity:read'] })
  await expect(store.recover(original)).rejects.toThrow('当前身份不能核对')
  expect(repository.execute).toHaveBeenCalledTimes(1)
  await store.recover(original)
  expect(repository.execute.mock.calls.at(-1)![0]).toEqual(original.command)
})

it('无法可靠保存原命令时不发送，错目标回执保留未知状态', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  const persist = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage unavailable')
  })
  await expect(store.submit(read, create)).rejects.toThrow('无法可靠保存原空鼓提交')
  expect(repository.execute).not.toHaveBeenCalled()
  persist.mockRestore()
  repository.execute.mockImplementationOnce(async (command: QuantityHollowCommand) => ({ ...hollowResult(command), commandId: 'another-command' }))
  await expect(store.submit(read, create)).rejects.toThrow('回执')
  expect(store.getPending(read)?.state).toBe('unknown')
})

it('正式空鼓仅持久最小定位；冷恢复查原编号，读取失败与撤权保留标记，原正文不进浏览器存储', async () => {
  await useProductionAccessStore().check()
  let store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  store.rememberDraft('formal-draft', { fields: { target: JSON.stringify(hollowTarget), inspectedOn: hollowInput.inspectedOn, rectifiedOn: '', count: '19', note: '正式私密原备注', reason: '' }, baseline: '', sourceVersion: read.sourceVersion, revisionId: null })
  repository.execute.mockRejectedValueOnce(new Error('原结果未知'))
  await expect(store.submit(read, create)).rejects.toThrow('原结果未知')
  const original = store.getPending(read)!
  const entries = Object.entries(sessionStorage)
  expect(entries).toEqual([[expect.stringContaining('crm:form-command:v1:quantity:'), expect.any(String)]])
  const descriptor = JSON.parse(entries[0]![1])
  expect(Object.keys(descriptor).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'scopeId', 'targetId', 'workspaceId'])
  expect(JSON.stringify(entries)).not.toContain(hollowInput.note)
  expect(JSON.stringify(entries)).not.toContain('正式私密原备注')
  setActivePinia(createPinia())
  await useProductionAccessStore().check()
  store = useQuantityHollowStore()
  await store.load(hollowQuery)
  expect(store.getDraft('formal-draft')).toBeNull()
  expect(store.pendingDescriptors).toEqual([descriptor])
  await expect(store.submit(await store.load(hollowQuery), create)).rejects.toThrow('原空鼓提交')
  expect(repository.execute).toHaveBeenCalledTimes(1)
  context.mockResolvedValueOnce({ ...hollowIdentity, actorId: 'another-actor' })
  await expect(store.recoverDescriptor(descriptor, hollowQuery)).rejects.toThrow('请回到原正式户与身份核对')
  expect(repository.resolve).not.toHaveBeenCalled()
  repository.resolve.mockResolvedValue({ outcome: 'applied', result: hollowResult(original.command) })
  repository.hollow.mockRejectedValueOnce(new Error('保存后读取失败'))
  await expect(store.recoverDescriptor(descriptor, hollowQuery)).rejects.toThrow('保存后读取失败')
  expect(sessionStorage.getItem(entries[0]![0])).toBe(entries[0]![1])
  repository.hollow.mockResolvedValueOnce(hollowRead([hollowRecord(original.command)]))
  await store.recoverDescriptor(descriptor, hollowQuery)
  expect(repository.resolve.mock.calls.map(row => row[0])).toEqual([descriptor, descriptor])
  expect(sessionStorage.getItem(entries[0]![0])).toBeNull()
  expect(store.pendingDescriptors).toEqual([])
})
