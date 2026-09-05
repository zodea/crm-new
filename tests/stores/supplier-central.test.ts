import type { SupplierDetailReadDTO, SupplierListPageDTO, SupplierListQueryDTO } from '~/lib/supplier/repository'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supplierProblem, SupplierRepositoryProblem } from '~/lib/supplier/repository'
import { useSupplierCommandStore } from '~/stores/supplier-command'
import { useSupplierReadStore } from '~/stores/supplier-read'

const query: SupplierListQueryDTO = { includeDemo: false, search: '', category: null, credentialStatus: null, sort: 'updated-desc', page: 1, pageSize: 10 }

describe('分供方中央 stores', () => {
  let uuid = 0
  const repositories = {
    supplierRead: { list: vi.fn(), get: vi.fn() },
    supplierCommands: { context: vi.fn(), loadForm: vi.fn(), execute: vi.fn() },
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uuid = 0
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: repositories }))
    vi.stubGlobal('crypto', { randomUUID: () => `supplier-command-${++uuid}` })
  })

  it('列表与详情分别进入可判定的 ReadState，跨实体失败不泄露上一条详情', async () => {
    const page = {
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0 },
      summary: { categories: [], credentialStatuses: [], origins: { real: { supplierCount: 0, contractAmount: '0.00', paymentAmount: '0.00' }, demo: { supplierCount: 0, contractAmount: '0.00', paymentAmount: '0.00' } } },
      empty: { reason: 'no-records', missingRelations: [] },
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: [],
    } as SupplierListPageDTO
    repositories.supplierRead.list.mockResolvedValue(page)
    repositories.supplierRead.get
      .mockResolvedValueOnce({ supplier: { id: 'supplier-a' } } as SupplierDetailReadDTO)
      .mockRejectedValueOnce(new SupplierRepositoryProblem(supplierProblem('unavailable', '分供方 B 加载失败', true)))
    const store = useSupplierReadStore()

    await store.loadList(query)
    await store.loadDetail({ id: 'supplier-a', origin: 'real', includeDemo: false })
    await store.loadDetail({ id: 'supplier-b', origin: 'real', includeDemo: false })

    expect(store.listState.kind).toBe('empty')
    expect(store.detailState).toMatchObject({ kind: 'error', previous: null })
  })

  it('命令使用会话身份和 baseVersion，并在响应丢失重试时复用 commandId', async () => {
    repositories.supplierCommands.context.mockResolvedValue({ workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['supplier:write'] })
    repositories.supplierCommands.loadForm.mockResolvedValue({ draft: { id: 'supplier-1', name: '原分供方' }, attachments: [], version: '3', updatedAt: '2026-08-23T00:00:00.000Z' })
    repositories.supplierCommands.execute
      .mockRejectedValueOnce(new SupplierRepositoryProblem(supplierProblem('unavailable', '响应丢失', true)))
      .mockResolvedValueOnce({ id: 'supplier-1', commandId: 'supplier-command-1', version: '4', updatedAt: '2026-08-23T01:00:00.000Z', attachmentIds: [] })
    const store = useSupplierCommandStore()
    const session = store.createSession()
    await store.hydrate(session, 'supplier-1')

    const draft = { id: 'supplier-1', name: '新分供方', supplierCategory: '材料供应商', contact: '陈经理' }
    await expect(store.saveForm(session, draft, 'save')).rejects.toBeInstanceOf(SupplierRepositoryProblem)
    await store.saveForm(session, draft, 'save')

    expect(repositories.supplierCommands.execute.mock.calls[0]?.[0]).toMatchObject({
      id: 'supplier-1',
      baseVersion: '3',
      commandId: 'supplier-command-1',
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
    })
    expect(repositories.supplierCommands.execute.mock.calls[0]?.[0].commandId)
      .toBe(repositories.supplierCommands.execute.mock.calls[1]?.[0].commandId)
    expect(store.latestWrite).toEqual({ id: 'supplier-1', version: '4' })
  })
})
