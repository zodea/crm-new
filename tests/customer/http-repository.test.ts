import { describe, expect, it, vi } from 'vitest'
import { createHttpCustomerCommandRepository } from '~/lib/customer/command-http-repository'
import { createHttpCustomerReadRepository } from '~/lib/customer/http-repository'
import {
  buildCustomerListPage,
  CustomerRepositoryProblem,
  parseCustomerListQuery,
} from '~/lib/customer/repository'
import { createCustomerReadTestInstance } from '../../server/utils/customer-read-test-instance'

describe('客户中央 HTTP Repository', () => {
  it('序列化列表与详情查询，不把路由字符串塞进领域结果', async () => {
    const page = buildCustomerListPage({
      rows: [],
      query: parseCustomerListQuery({}),
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['customer:list:read'],
    })
    const fetcher = vi.fn().mockResolvedValue(page)
    const repository = createHttpCustomerReadRepository({ fetcher })

    await repository.list(parseCustomerListQuery({ search: '合和', page: '2' }))

    expect(fetcher).toHaveBeenCalledWith('/api/read/customers', {
      query: expect.objectContaining({ search: '合和', page: '2', includeDemo: 'false' }),
    })
  })

  it('读取收款详情时把父客户稳定 ID 一并送到中央后台', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('stop after request capture'))
    const repository = createHttpCustomerReadRepository({ fetcher })

    await expect(repository.getReceipt({
      id: 'receipt-1',
      customerId: 'customer-1',
      origin: 'demo',
      includeDemo: true,
    })).rejects.toBeInstanceOf(CustomerRepositoryProblem)

    expect(fetcher).toHaveBeenCalledWith('/api/read/receipts/receipt-1', {
      query: { origin: 'demo', includeDemo: 'true', customerId: 'customer-1' },
    })
  })

  it('拒绝结构错误的中央读取与命令响应', async () => {
    const reads = createHttpCustomerReadRepository({
      fetcher: vi.fn().mockResolvedValue({ items: 'invalid' }),
    })
    const commands = createHttpCustomerCommandRepository({
      fetcher: vi.fn().mockResolvedValue({ id: 123 }),
    })

    await expect(reads.list(parseCustomerListQuery({}))).rejects.toMatchObject<CustomerRepositoryProblem>({
      problem: { code: 'internal-error' },
    })
    await expect(commands.context()).rejects.toMatchObject<CustomerRepositoryProblem>({
      problem: { code: 'internal-error' },
    })
  })

  it('拒绝外壳合法但汇总或表单附件内部畸形的响应', async () => {
    const page = buildCustomerListPage({
      rows: [],
      query: parseCustomerListQuery({}),
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['customer:list:read'],
    })
    const reads = createHttpCustomerReadRepository({
      fetcher: vi.fn().mockResolvedValue({
        ...page,
        summary: { statuses: [], origins: {} },
      }),
    })
    const commands = createHttpCustomerCommandRepository({
      fetcher: vi.fn().mockResolvedValue({
        draft: { id: 'customer-1', name: '客户', contact: '陈经理', aliases: [] },
        attachments: [null],
        version: '1',
        updatedAt: '2026-08-23T00:00:00.000Z',
      }),
    })

    await expect(reads.list(parseCustomerListQuery({}))).rejects.toMatchObject<CustomerRepositoryProblem>({
      problem: { code: 'internal-error' },
    })
    await expect(commands.loadForm('customer-1')).rejects.toMatchObject<CustomerRepositoryProblem>({
      problem: { code: 'internal-error' },
    })
  })

  it('拒绝列表引用与导航主体 ID 不一致的响应', async () => {
    const page = buildCustomerListPage({
      rows: [{
        dataOrigin: 'real',
        id: 'customer-1',
        name: '客户一',
        aliases: [],
        taxNo: '',
        legalRep: '',
        registeredAddress: '',
        invoiceName: '',
        bank: '',
        bankAccount: '',
        contact: '陈经理',
        contactPhone: '',
        status: 'active',
        note: '',
        updatedAt: '2026-08-23T00:00:00.000Z',
      }],
      query: parseCustomerListQuery({}),
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['customer:list:read'],
    })
    const item = page.items[0]!
    const reads = createHttpCustomerReadRepository({
      fetcher: vi.fn().mockResolvedValue({
        ...page,
        items: [{
          ...item,
          navigation: {
            ...item.navigation,
            subject: { ...item.navigation.subject, id: 'customer-2' },
          },
        }],
      }),
    })

    await expect(reads.list(parseCustomerListQuery({})))
      .rejects
      .toMatchObject<CustomerRepositoryProblem>({ problem: { code: 'internal-error' } })
  })

  it('拒绝收款导航父客户与详情客户身份不一致的响应', async () => {
    const central = createCustomerReadTestInstance(() => ['customer:list:read', 'demo:read'])
    const detail = await central.receipt('rr_mz0x1_0', {
      origin: 'demo',
      includeDemo: 'true',
      customerId: 'customer_demo_001',
    })
    const reads = createHttpCustomerReadRepository({
      fetcher: vi.fn().mockResolvedValue({
        ...detail,
        receipt: {
          ...detail.receipt,
          navigation: {
            ...detail.receipt.navigation,
            filters: { ...detail.receipt.navigation.filters, customerId: 'customer_demo_002' },
          },
        },
      }),
    })

    await expect(reads.getReceipt({
      id: 'rr_mz0x1_0',
      customerId: 'customer_demo_001',
      origin: 'demo',
      includeDemo: true,
    }))
      .rejects
      .toMatchObject<CustomerRepositoryProblem>({ problem: { code: 'internal-error' } })
  })

  it('拒绝客户详情夹带属于另一客户的收款关系', async () => {
    const central = createCustomerReadTestInstance(() => ['customer:list:read', 'demo:read'])
    const detail = await central.detail('customer_demo_001', {
      origin: 'demo',
      includeDemo: 'true',
    })
    const [firstReceipt, ...rest] = detail.receipts
    expect(firstReceipt).toBeDefined()
    const reads = createHttpCustomerReadRepository({
      fetcher: vi.fn().mockResolvedValue({
        ...detail,
        receipts: [{
          ...firstReceipt!,
          navigation: {
            ...firstReceipt!.navigation,
            filters: {
              ...firstReceipt!.navigation.filters,
              customerId: 'customer_demo_002',
            },
          },
        }, ...rest],
      }),
    })

    await expect(reads.get({
      id: 'customer_demo_001',
      origin: 'demo',
      includeDemo: true,
    }))
      .rejects
      .toMatchObject<CustomerRepositoryProblem>({ problem: { code: 'internal-error' } })
  })
})
