import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useTargetCostListStore } from '~/stores/target-cost-list'

const load = vi.hoisted(() => vi.fn())
vi.mock('~/lib/db/connection', () => ({ getDb: async () => ({}) }))
vi.mock('~/lib/target-cost/list', () => ({ loadTargetCostList: load }))

beforeEach(() => {
  setActivePinia(createPinia())
  load.mockReset()
})

it('首次失败不能伪造快照，成功空结果刷新保留快照，失败仍可辨认', async () => {
  const store = useTargetCostListStore()
  load.mockRejectedValueOnce(new Error('首次读取失败'))
  await store.load()
  expect(store.hasSnapshot).toBe(false)
  expect(store.error).toContain('首次读取失败')
  load.mockResolvedValueOnce([])
  await store.load()
  expect(store.hasSnapshot).toBe(true)
  let reject!: (error: Error) => void
  load.mockImplementationOnce(() => new Promise((_, no) => {
    reject = no
  }))
  const pending = store.load()
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3))
  expect(store.loading).toBe(true)
  expect(store.hasSnapshot).toBe(true)
  expect(store.rows).toEqual([])
  reject(new Error('刷新失败'))
  await pending
  expect(store.hasSnapshot).toBe(true)
  expect(store.error).toContain('刷新失败')
})
