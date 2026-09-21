// @vitest-environment jsdom
import type { QuantityHollowCommand, QuantityHollowRead } from '../../app/lib/quantity/central-hollow-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useQuantityHollowStore } from '~/stores/quantity-hollow'
import { hollowIdentity, hollowInput, hollowQuery, hollowRead, hollowRecord, hollowResult, hollowTarget } from '../helpers/quantity-hollow-ui-fixture'

const repository = { hollow: vi.fn(), execute: vi.fn() }
const context = vi.fn()
const create = { kind: 'create-hollow-inspection' as const, target: hollowTarget, input: hollowInput }
beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  context.mockResolvedValue(structuredClone(hollowIdentity))
  repository.hollow.mockImplementation(async () => hollowRead())
  repository.execute.mockImplementation(async command => hollowResult(command))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { quantity: repository, projectCommands: { context } } }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('响应丢失冷恢复保原键原正文，后来版本不能覆盖原提交', async () => {
  let store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  repository.execute.mockRejectedValueOnce(new Error('响应丢失'))
  await expect(store.submit(read, create)).rejects.toThrow()
  const original = store.getPending(read)!
  expect(original.state).toBe('unknown')
  setActivePinia(createPinia())
  store = useQuantityHollowStore()
  repository.hollow.mockResolvedValueOnce(hollowRead([], 'quantity-newer'))
  const newer = await store.load(hollowQuery)
  expect(store.getPending(newer)).toEqual(original)
  await expect(store.submit(newer, { ...create, input: { ...hollowInput, count: 30 } })).rejects.toThrow()
  await store.recover(original)
  expect(repository.execute.mock.calls.at(-1)![0]).toEqual(original.command)
  expect(store.getPending(newer)?.state).toBe('awaiting-read')
})

it('成功回执只能由可信同目标后读核实，历史原修订不必仍为最新', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  await store.submit(read, create)
  const original = store.getPending(read)!
  expect(() => store.acknowledge(original, read)).toThrow()
  const missing = await store.load(hollowQuery)
  expect(() => store.acknowledge(original, missing)).toThrow()
  const record = hollowRecord(original.command)
  const later = { ...record.inspection, revisionId: 'revision-later', previousRevisionId: 'revision', commandId: 'later-command', logId: 'later-log', reason: '后来复查', input: { ...hollowInput, count: 20 } }
  record.revisions.push(later)
  record.inspection = later
  record.remainingCount = 20
  record.proof = { ...record.proof, revisionId: later.revisionId, headLogId: later.logId }
  const response = hollowRead([record], 'quantity-v3')
  expect(() => store.acknowledge(original, response)).toThrow()
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
  expect(() => store.acknowledge(original, late)).toThrow()
  expect(store.getPending(read)?.state).toBe('awaiting-read')
})

it('重新读取失败不清回执，改正文的伪造后读不能解除等待', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  await store.submit(read, create)
  const original = store.getPending(read)!
  repository.hollow.mockRejectedValueOnce(new Error('读失败'))
  await expect(store.load(hollowQuery)).rejects.toThrow()
  expect(store.getPending(read)?.state).toBe('awaiting-read')
  repository.hollow.mockResolvedValueOnce(hollowRead([hollowRecord(original.command)], 'quantity-v2'))
  const fresh = await store.load(hollowQuery)
  fresh.data.records[0]!.originalPartyName = '伪造的姓名'
  expect(() => store.acknowledge(original, fresh)).toThrow()
})

it('当前身份变化或撤权不能重放原提交，原正文仍可供原身份恢复', async () => {
  const store = useQuantityHollowStore()
  const read = await store.load(hollowQuery)
  repository.execute.mockRejectedValueOnce(new Error('响应丢失'))
  await expect(store.submit(read, create)).rejects.toThrow()
  const original = store.getPending(read)!
  context.mockResolvedValueOnce({ ...hollowIdentity, actorId: 'other-actor' })
  await expect(store.recover(original)).rejects.toThrow()
  context.mockResolvedValueOnce({ ...hollowIdentity, capabilities: ['quantity:read'] })
  await expect(store.recover(original)).rejects.toThrow()
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
  await expect(store.submit(read, create)).rejects.toThrow()
  expect(repository.execute).not.toHaveBeenCalled()
  persist.mockRestore()
  repository.execute.mockImplementationOnce(async (command: QuantityHollowCommand) => ({ ...hollowResult(command), commandId: 'another-command' }))
  await expect(store.submit(read, create)).rejects.toThrow()
  expect(store.getPending(read)?.state).toBe('unknown')
})
