import type { ProductionAccessStatus } from '~/lib/customer/access-repository'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useMaterialContractReadStore } from '~/stores/material-contract-read'
import { useProductionAccessStore } from '~/stores/production-access'
import { createMaterialContractReadTestInstance } from '../../server/utils/material-contract-read-test-instance'

beforeEach(() => setActivePinia(createPinia()))

it('暂不可用保同来源旧事实；401清事实，来源切换不带旧快照', async () => {
  const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
  const query = { includeDemo: true, origin: null, search: '', projectId: null, supplierId: null, status: null, page: 1, pageSize: 10 } as const
  const page = read.list({ includeDemo: 'true' })
  const list = vi.fn().mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('连接失败')).mockRejectedValueOnce({ response: { status: 401, _data: '损坏正文' } }).mockRejectedValueOnce(new Error('新来源未连接'))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractRead: { list } } }))
  const store = useMaterialContractReadStore()
  await store.loadList(query)
  await store.loadList({ ...query, search: '同来源新筛选' })
  expect(store.listState).toMatchObject({ kind: 'unavailable', previous: page })
  await store.loadList(query)
  expect(store.listState).toMatchObject({ kind: 'forbidden', problem: { code: 'unauthenticated', retryable: false } })
  expect('previous' in store.listState).toBe(false)
  await store.loadList({ ...query, includeDemo: false, origin: 'real' })
  expect(store.listState).toMatchObject({ kind: 'unavailable', previous: null })
})

it('真实访问状态切换同步清读取与候选目标；较早列表和详情完成不能重新展示旧身份事实', async () => {
  const read = createMaterialContractReadTestInstance(() => ['material-contract:read', 'demo:read'])
  const page = read.list({ includeDemo: 'true' })
  const detail = read.detail('con_demo_cg01', { origin: 'demo', includeDemo: 'true' })
  let status: ProductionAccessStatus = { mode: 'production', authenticated: true, ownerId: 'owner-a', purpose: 'verification', expiresAt: '2026-10-04T20:00:00.000Z' }
  let finishList!: (value: typeof page) => void
  let finishDetail!: (value: typeof detail) => void

  const list = vi.fn().mockResolvedValueOnce(page).mockImplementationOnce(() => new Promise((resolve) => {
    finishList = resolve
  }))

  const get = vi.fn().mockResolvedValueOnce(detail).mockImplementationOnce(() => new Promise((resolve) => {
    finishDetail = resolve
  }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { materialContractRead: { list, get }, productionAccess: { status: () => Promise.resolve(status) } } }))
  const access = useProductionAccessStore()
  await access.check()
  const store = useMaterialContractReadStore()
  const query = { includeDemo: true, origin: null, search: '', projectId: null, supplierId: null, status: null, page: 1, pageSize: 10 } as const
  const detailQuery = { id: 'con_demo_cg01', origin: 'demo', includeDemo: true } as const
  await store.loadList(query)
  await store.loadDetail(detailQuery)
  const pending = [store.loadList(query), store.loadDetail(detailQuery)]
  status = { mode: 'production', authenticated: false, purpose: 'verification' }
  await access.check()
  expect(store.listState).toMatchObject({ kind: 'forbidden', problem: { code: 'unauthenticated' } })
  expect(store.detailState).toMatchObject({ kind: 'forbidden' })
  expect(store.listQuery).toBeNull()
  expect(store.detailQuery).toBeNull()
  finishList(page)
  finishDetail(detail)
  await Promise.all(pending)
  expect(store.listState.kind).toBe('forbidden')
  expect(store.detailState.kind).toBe('forbidden')
  expect(JSON.stringify([store.listState, store.detailState])).not.toContain('con_demo_cg01')
  status = { mode: 'production', authenticated: true, ownerId: 'owner-b', purpose: 'production', expiresAt: '2026-10-04T20:00:00.000Z' }
  await access.check()
  expect(store.listState).toMatchObject({ kind: 'unavailable', previous: null })
  expect(store.detailState).toMatchObject({ kind: 'unavailable', previous: null })
})
