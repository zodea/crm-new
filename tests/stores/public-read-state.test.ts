import type { DataOriginDTO, ReadState } from '~/types/read-model'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProductionAccessRepository } from '~/lib/customer/access-repository'
import { useConstructionContractReadStore } from '~/stores/construction-contract-read'
import { useCrewWorkerReadStore } from '~/stores/crew-worker-read'
import { useCustomerReadStore } from '~/stores/customer-read'
import { useOwnerCommercialDocumentReadStore } from '~/stores/owner-commercial-document-read'
import { useProductionAccessStore } from '~/stores/production-access'
import { useProjectListStore } from '~/stores/project-list'
import { useProjectSupplierReadStore } from '~/stores/project-supplier-read'
import { useSubcontractContractReadStore } from '~/stores/subcontract-contract-read'

const domains = ['customer', 'crew-worker', 'construction', 'subcontract', 'owner-document', 'project', 'project-supplier'] as const
type Domain = typeof domains[number]
const snapshot = { privateFact: '原授权事实', items: [{ id: 'original-record' }], empty: null, counts: { contracts: 1 } }
const unavailable = { code: 'unavailable', message: '来源暂不可用', retryable: true, fieldErrors: {}, traceId: null }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture(domain: Domain) {
  setActivePinia(createPinia())
  let ownerId = 'owner-read-original'
  let expiresAt = '2026-10-05T00:00:00.000Z'
  const productionAccess = createProductionAccessRepository(async (url) => {
    if (url === '/api/auth/logout')
      return { authenticated: false }
    return { mode: 'production', purpose: 'verification', authenticated: true, ownerId, expiresAt }
  })
  const read = vi.fn(async () => structuredClone(snapshot))
  vi.stubGlobal('useNuxtApp', () => ({
    $repositories: {
      productionAccess,
      customerRead: { get: read },
      crewWorkerRead: { getWorker: read },
      constructionContractRead: { get: read },
      subcontractContractRead: { get: read },
      ownerCommercialDocumentRead: { get: read },
      projectList: { list: read },
      projectSupplierRead: { get: read },
    },
  }))
  const access = useProductionAccessStore()
  await access.check()
  const detailQuery = (id: string, origin: DataOriginDTO) => ({ id, origin, includeDemo: origin === 'demo' })
  let load!: (id?: string, origin?: DataOriginDTO) => Promise<void>
  let state!: () => ReadState<unknown>
  if (domain === 'customer') {
    const store = useCustomerReadStore()
    load = (id = 'target-original', origin = 'real') => store.loadDetail(detailQuery(id, origin))
    state = () => store.detailState
  }
  else if (domain === 'crew-worker') {
    const store = useCrewWorkerReadStore()
    load = (id = 'target-original', origin = 'real') => store.loadWorkerDetail(detailQuery(id, origin))
    state = () => store.workerDetailState
  }
  else if (domain === 'construction') {
    const store = useConstructionContractReadStore()
    load = (id = 'target-original', origin = 'real') => store.loadDetail({ ...detailQuery(id, origin), focus: null })
    state = () => store.detailState
  }
  else if (domain === 'subcontract') {
    const store = useSubcontractContractReadStore()
    load = (id = 'target-original', origin = 'real') => store.loadDetail({ ...detailQuery(id, origin), focusId: null })
    state = () => store.detailState
  }
  else if (domain === 'owner-document') {
    const store = useOwnerCommercialDocumentReadStore()
    load = (id = 'target-original', origin = 'real') => store.loadDetail({ ...detailQuery(id, origin), kind: 'owner_change', variant: null })
    state = () => store.detailState
  }
  else if (domain === 'project') {
    const store = useProjectListStore()
    load = (_id = 'target-original', origin = 'real') => store.load({ includeDemo: origin === 'demo', search: '', status: null, sort: 'updated-desc', page: 1, pageSize: 20, filters: { statuses: [], plannedEnds: [], managers: [], customerIds: [] } })
    state = () => store.state
  }
  else {
    const store = useProjectSupplierReadStore()
    load = (id = 'target-original', origin = 'real') => store.load({ projectId: id, supplierId: 'supplier-target', origin, includeDemo: origin === 'demo' })
    state = () => store.state
  }
  return { load, state, read, access, replaceOwner: async () => {
    ownerId = 'owner-read-replacement'
    await access.check()
  }, renewExpiry: async () => {
    expiresAt = '2026-10-06T00:00:00.000Z'
    await access.check()
  } }
}

afterEach(() => vi.unstubAllGlobals())

describe.each(domains)('%s公共读取发布与会话事实隔离', (domain) => {
  it('合法同目标503显式来源不可用并保旧快照，401清事实而不保private字段', async () => {
    const f = await fixture(domain)
    await f.load()
    expect(f.state().kind).toBe('ready')
    f.read.mockRejectedValueOnce({ response: { status: 503, _data: { data: unavailable } } })
    await f.load()
    expect(f.state()).toMatchObject({ kind: 'unavailable', previous: snapshot, problem: { code: 'unavailable' } })
    f.read.mockRejectedValueOnce({ response: { status: 401, _data: { data: { code: 'not-a-public-code' } } } })
    await f.load()
    expect(f.state()).toMatchObject({ kind: 'forbidden', problem: { code: 'unauthenticated', retryable: false } })
    expect(JSON.stringify(f.state())).not.toContain(snapshot.privateFact)
    expect(f.state()).not.toHaveProperty('previous')
  })

  it('切来源的未完成读取和失败都不能保上一来源事实', async () => {
    const f = await fixture(domain)
    await f.load()
    const changed = deferred<typeof snapshot>()
    f.read.mockImplementationOnce(() => changed.promise)
    const pending = f.load('target-new', 'demo')
    expect(f.state()).toEqual({ kind: 'loading', previous: null })
    changed.resolve(structuredClone(snapshot))
    await pending
    expect(f.state().kind).toBe('ready')
  })

  it('实际退出事件同步清事实，退出前迟到成功不能重新进入缓存', async () => {
    const f = await fixture(domain)
    await f.load()
    const old = deferred<typeof snapshot>()
    f.read.mockImplementationOnce(() => old.promise)
    const pending = f.load()
    await f.access.logout()
    expect(f.state()).toMatchObject({ kind: 'forbidden', problem: { code: 'unauthenticated' } })
    old.resolve(structuredClone(snapshot))
    await pending
    expect(f.state()).toMatchObject({ kind: 'forbidden', problem: { code: 'unauthenticated' } })
    expect(JSON.stringify(f.state())).not.toContain(snapshot.privateFact)
  })

  it('真实owner替换撤回原响应，普通有效期续延不捏造身份变化', async () => {
    const f = await fixture(domain)
    await f.load()
    const beforeRenew = f.state()
    await f.renewExpiry()
    expect(f.state()).toBe(beforeRenew)
    const old = deferred<typeof snapshot>()
    f.read.mockImplementationOnce(() => old.promise)
    const pending = f.load()
    await f.replaceOwner()
    expect(f.state()).toMatchObject({ kind: 'unavailable', previous: null })
    old.resolve(structuredClone(snapshot))
    await pending
    expect(f.state()).toMatchObject({ kind: 'unavailable', previous: null })
    expect(JSON.stringify(f.state())).not.toContain(snapshot.privateFact)
  })
})
