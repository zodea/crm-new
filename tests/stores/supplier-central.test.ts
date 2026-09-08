import type { SupplierDetailReadDTO, SupplierListPageDTO, SupplierListQueryDTO } from '~/lib/supplier/repository'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { supplierProblem, SupplierRepositoryProblem } from '~/lib/supplier/repository'
import { useSupplierCommandStore } from '~/stores/supplier-command'
import { useSupplierReadStore } from '~/stores/supplier-read'

const query: SupplierListQueryDTO = { includeDemo: false, search: '', category: null, credentialStatus: null, sort: 'updated-desc', page: 1, pageSize: 10 }

describe('分供方中央 stores', () => {
  let uuid = 0
  const repositories = {
    supplierRead: { list: vi.fn(), get: vi.fn() },
    supplierCommands: { context: vi.fn(), loadForm: vi.fn(), execute: vi.fn(), importRow: vi.fn() },
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
    await store.hydrate('supplier-1')

    const draft = { id: 'supplier-1', name: '新分供方', supplierCategory: '材料供应商', contact: '陈经理' }
    await expect(store.saveForm(draft, 'save')).rejects.toBeInstanceOf(SupplierRepositoryProblem)
    await store.saveForm(draft, 'save')

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

  it('同来源筛选保留快照，关闭测试数据时立即清除旧来源快照', async () => {
    const page = { items: [{ dataOrigin: 'demo', supplier: { id: 'demo-supplier' } }], empty: null, capabilities: ['supplier:write'] } as SupplierListPageDTO
    repositories.supplierRead.list.mockResolvedValueOnce(page)
    const store = useSupplierReadStore()
    await store.loadList({ ...query, includeDemo: true })
    let finishFilter!: (value: SupplierListPageDTO) => void
    repositories.supplierRead.list.mockReturnValueOnce(new Promise<SupplierListPageDTO>(resolve => finishFilter = resolve))
    const filtering = store.loadList({ ...query, includeDemo: true, search: '测试' })
    expect(store.listState).toMatchObject({ kind: 'loading', previous: page })
    finishFilter(page)
    await filtering
    let finishSourceChange!: (value: SupplierListPageDTO) => void
    repositories.supplierRead.list.mockReturnValueOnce(new Promise<SupplierListPageDTO>(resolve => finishSourceChange = resolve))
    const switching = store.loadList({ ...query, includeDemo: false })
    try {
      expect(store.listState).toMatchObject({ kind: 'loading', previous: null })
    }
    finally {
      finishSourceChange({ ...page, items: [] })
      await switching
    }
  })

  it('导入回读成功通知缓存，但不覆盖当前编辑目标、baseVersion 或失败保存的命令 ID', async () => {
    repositories.supplierCommands.context.mockResolvedValue({ workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['supplier:write'] })
    repositories.supplierCommands.loadForm
      .mockResolvedValueOnce({ draft: { id: 'editing-supplier', name: '正在编辑' }, attachments: [], version: '3', updatedAt: '2026-09-08T00:00:00.000Z' })
      .mockResolvedValueOnce({ draft: { id: 'imported-supplier', name: '另一家导入供方' }, attachments: [], version: '2', updatedAt: '2026-09-08T01:00:00.000Z' })
    repositories.supplierCommands.execute
      .mockRejectedValueOnce(new SupplierRepositoryProblem(supplierProblem('unavailable', '保存响应丢失', true)))
      .mockResolvedValueOnce({ id: 'editing-supplier', version: '4', updatedAt: '2026-09-08T02:00:00.000Z', attachmentIds: [] })
    repositories.supplierCommands.importRow.mockResolvedValue({ id: 'imported-supplier', version: '2', updatedAt: '2026-09-08T01:00:00.000Z', attachmentIds: [] })
    const store = useSupplierCommandStore()
    await store.hydrate('editing-supplier')
    const draft = { id: 'editing-supplier', name: '正在编辑（修改）', supplierCategory: '其他', contact: '联系人' }
    await expect(store.saveForm(draft, 'save')).rejects.toBeInstanceOf(SupplierRepositoryProblem)

    await store.importRow({ name: '另一家导入供方', externalRef: 'OLD-IMPORTED' })
    expect(store.latestWrite).toEqual({ id: 'imported-supplier', version: '2' })
    expect(repositories.supplierCommands.loadForm).toHaveBeenLastCalledWith('imported-supplier')
    await store.saveForm(draft, 'save')
    const [first, retried] = repositories.supplierCommands.execute.mock.calls.map(([request]) => request)
    expect(retried).toMatchObject({ id: 'editing-supplier', baseVersion: '3', commandId: first.commandId, draft })
    expect(store.latestWrite).toEqual({ id: 'editing-supplier', version: '4' })
  })

  it('导入写入或回读失败不通知缓存，续导完成后才通知且沿用该行命令 ID', async () => {
    repositories.supplierCommands.context.mockResolvedValue({ workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['supplier:write'] })
    const result = { id: 'imported-supplier', version: '1', updatedAt: '2026-09-08T00:00:00.000Z', attachmentIds: [] }
    repositories.supplierCommands.importRow
      .mockRejectedValueOnce(new Error('写入响应丢失'))
      .mockResolvedValue(result)
    let completeRead!: (value: unknown) => void
    const reading = new Promise(resolve => completeRead = resolve)
    repositories.supplierCommands.loadForm
      .mockRejectedValueOnce(new Error('中央回读失败'))
      .mockReturnValueOnce(reading)
    const store = useSupplierCommandStore()
    const notified = vi.fn()
    const stop = watch(() => store.latestWrite, notified, { flush: 'sync' })
    const row = { name: '待回读分供方' }
    await expect(store.importRow(row)).rejects.toThrow('写入响应丢失')
    await expect(store.importRow(row)).rejects.toThrow('中央回读失败')
    expect(notified).not.toHaveBeenCalled()
    expect(store.latestWrite).toBeNull()
    const retry = store.importRow(row)
    expect(store.latestWrite).toBeNull()
    completeRead({ draft: { id: result.id, name: row.name }, attachments: [], version: '1', updatedAt: result.updatedAt })
    await retry
    expect(notified).toHaveBeenCalledTimes(1)
    expect(store.latestWrite).toEqual({ id: result.id, version: result.version })
    expect(new Set(repositories.supplierCommands.importRow.mock.calls.map(([request]) => request.commandId)).size).toBe(1)
    stop()
  })
})
