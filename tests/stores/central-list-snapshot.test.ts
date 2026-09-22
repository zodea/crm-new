import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCrewWorkerReadStore } from '~/stores/crew-worker-read'
import { useCustomerReadStore } from '~/stores/customer-read'

afterEach(() => vi.unstubAllGlobals())

describe('中央档案列表旧快照范围', () => {
  it.each(['customer', 'crew', 'worker'] as const)('%s 同可见范围筛选保留快照，收起测试数据时立即丢弃', async (kind) => {
    setActivePinia(createPinia())
    const fetcher = vi.fn()
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { customerRead: { list: fetcher }, crewWorkerRead: { listCrews: fetcher, listWorkers: fetcher } } }))
    const customer = useCustomerReadStore()
    const crewWorker = useCrewWorkerReadStore()
    const load = (includeDemo: boolean, search = '') => {
      const base = { includeDemo, search, status: [], sort: 'updated-desc' as const, page: 1, pageSize: 10 as const }
      return kind === 'customer' ? customer.loadList(base) : kind === 'crew' ? crewWorker.loadCrewList({ ...base, trade: [] }) : crewWorker.loadWorkerList({ ...base, trade: [], crewId: null, projectStatus: [] })
    }
    const state = () => kind === 'customer' ? customer.listState : kind === 'crew' ? crewWorker.crewListState : crewWorker.workerListState
    const page = { items: [{ dataOrigin: 'demo' }], empty: null }
    fetcher.mockResolvedValueOnce(page)
    await load(true)
    let resolve!: (value: unknown) => void
    fetcher.mockImplementationOnce(() => new Promise(done => resolve = done))
    const sameScope = load(true, '筛选')
    expect(state()).toMatchObject({ kind: 'loading', previous: page })
    resolve(page)
    await sameScope
    fetcher.mockRejectedValueOnce(new Error('network unavailable'))
    const changedScope = load(false)
    expect(state()).toMatchObject({ kind: 'loading', previous: null })
    await changedScope
    expect(state()).toMatchObject({ kind: 'error', previous: null })
  })
})
