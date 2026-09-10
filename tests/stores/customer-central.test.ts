import type {
  CustomerDetailReadDTO,
  CustomerListPageDTO,
  CustomerListQueryDTO,
  CustomerReceiptDetailReadDTO,
} from '~/lib/customer/repository'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { customerProblem, CustomerRepositoryProblem } from '~/lib/customer/repository'
import { useCustomerCommandStore } from '~/stores/customer-command'
import { useCustomerReadStore } from '~/stores/customer-read'

const query: CustomerListQueryDTO = {
  includeDemo: false,
  search: '',
  status: null,
  sort: 'updated-desc',
  page: 1,
  pageSize: 10,
}

describe('客户中央 stores', () => {
  let uuid = 0
  const repositories = {
    customerRead: { list: vi.fn(), get: vi.fn(), getReceipt: vi.fn() },
    customerCommands: { context: vi.fn(), loadForm: vi.fn(), execute: vi.fn() },
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    uuid = 0
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: repositories }))
    vi.stubGlobal('crypto', { randomUUID: () => `command-${++uuid}` })
  })

  it('列表与详情分别进入可判定的 ReadState', async () => {
    const page = {
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0 },
      summary: { statuses: [], origins: { real: { customerCount: 0 }, demo: { customerCount: 0 } } },
      empty: { reason: 'no-records', missingRelations: [] },
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: [],
    } as CustomerListPageDTO
    const detail = { customer: { id: 'c-1' } } as CustomerDetailReadDTO
    repositories.customerRead.list.mockResolvedValue(page)
    repositories.customerRead.get.mockResolvedValue(detail)
    const store = useCustomerReadStore()

    await store.loadList(query)
    await store.loadDetail({ id: 'c-1', origin: 'real', includeDemo: false })

    expect(store.listState.kind).toBe('empty')
    expect(store.detailState.kind).toBe('ready')
  })

  it('跨实体加载失败时不在新地址下泄露上一条客户或收款详情', async () => {
    const customerA = { customer: { id: 'customer-a' } } as CustomerDetailReadDTO
    const receiptA = { receipt: { receipt: { id: 'receipt-a' } } } as CustomerReceiptDetailReadDTO
    repositories.customerRead.get
      .mockResolvedValueOnce(customerA)
      .mockRejectedValueOnce(new CustomerRepositoryProblem(customerProblem('unavailable', '客户 B 加载失败', true)))
    repositories.customerRead.getReceipt
      .mockResolvedValueOnce(receiptA)
      .mockRejectedValueOnce(new CustomerRepositoryProblem(customerProblem('unavailable', '收款 B 加载失败', true)))
    const store = useCustomerReadStore()

    await store.loadDetail({ id: 'customer-a', origin: 'real', includeDemo: false })
    await store.loadDetail({ id: 'customer-b', origin: 'real', includeDemo: false })
    await store.loadReceipt({ id: 'receipt-a', customerId: 'customer-a', origin: 'demo', includeDemo: true })
    await store.loadReceipt({ id: 'receipt-b', customerId: 'customer-b', origin: 'demo', includeDemo: true })

    expect(store.detailState).toMatchObject({ kind: 'error', previous: null })
    expect(store.receiptState).toMatchObject({ kind: 'error', previous: null })
  })

  it('命令使用会话身份和服务端版本，并记录最新写入供读模型刷新', async () => {
    repositories.customerCommands.context.mockResolvedValue({
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      capabilities: ['customer:write'],
    })
    repositories.customerCommands.loadForm.mockResolvedValue({
      draft: { id: 'c-1', name: '原客户' },
      attachments: [],
      version: '3',
      updatedAt: '2026-08-23T00:00:00.000Z',
    })
    repositories.customerCommands.execute.mockResolvedValue({
      id: 'c-1',
      commandId: 'command-1',
      version: '4',
      updatedAt: '2026-08-23T01:00:00.000Z',
      attachmentIds: [],
    })
    const store = useCustomerCommandStore()
    const session = store.createSession()
    await store.hydrate(session, 'c-1')
    await store.saveForm(session, { id: 'c-1', name: '新客户' }, 'save')

    expect(repositories.customerCommands.execute).toHaveBeenCalledWith(expect.objectContaining({
      id: 'c-1',
      baseVersion: '3',
      commandId: 'command-1',
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
    }))
    expect(store.latestWrite).toEqual({ id: 'c-1', version: '4' })
  })

  it('响应丢失后重试同一次新建意图时复用 commandId', async () => {
    repositories.customerCommands.context.mockResolvedValue({
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      capabilities: ['customer:write'],
    })
    repositories.customerCommands.execute
      .mockRejectedValueOnce(new CustomerRepositoryProblem(
        customerProblem('unavailable', '响应丢失', true),
      ))
      .mockResolvedValueOnce({
        id: 'c-retried',
        commandId: 'command-1',
        version: '1',
        updatedAt: '2026-08-23T01:00:00.000Z',
        attachmentIds: [],
      })
    const store = useCustomerCommandStore()
    const session = store.createSession()
    await store.hydrate(session, null)

    await expect(store.saveForm(session, { name: '幂等客户' }, 'save')).rejects.toBeInstanceOf(CustomerRepositoryProblem)
    await store.saveForm(session, { name: '幂等客户' }, 'save')

    expect(repositories.customerCommands.execute.mock.calls[0]?.[0].commandId)
      .toBe(repositories.customerCommands.execute.mock.calls[1]?.[0].commandId)
  })
})
