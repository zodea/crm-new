import type {
  SupplierRepositoryProblem,
} from '~/lib/supplier/repository'
import { describe, expect, it, vi } from 'vitest'
import { createHttpSupplierReadRepository } from '~/lib/supplier/http-repository'
import {
  buildSupplierListPage,
  parseSupplierDetailQuery,
  parseSupplierListQuery,
} from '~/lib/supplier/repository'

describe('分供方中央 HTTP Repository', () => {
  it('序列化列表与详情查询并解码中央响应', async () => {
    const page = buildSupplierListPage({
      suppliers: [],
      projectSuppliers: [],
      contracts: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      query: parseSupplierListQuery({}),
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['supplier:list:read'],
    })
    const fetcher = vi.fn().mockResolvedValue(page)
    const repository = createHttpSupplierReadRepository({ fetcher })

    await repository.list(parseSupplierListQuery({ search: '五金', page: '2' }))

    expect(fetcher).toHaveBeenCalledWith('/api/read/suppliers', {
      query: expect.objectContaining({
        search: '五金',
        page: '2',
        includeDemo: 'false',
      }),
    })
  })

  it('拒绝畸形中央列表和详情响应', async () => {
    const repository = createHttpSupplierReadRepository({
      fetcher: vi.fn().mockResolvedValue({ items: 'invalid' }),
    })

    await expect(repository.list(parseSupplierListQuery({})))
      .rejects
      .toMatchObject<SupplierRepositoryProblem>({ problem: { code: 'internal-error' } })
    await expect(repository.get(parseSupplierDetailQuery('supplier-1', {})))
      .rejects
      .toMatchObject<SupplierRepositoryProblem>({ problem: { code: 'internal-error' } })
  })

  it.each([
    ['错误 variant', { variant: 'edit' }],
    ['错误 view', { view: 'overview' }],
    ['缺少来源过滤', { filters: {} }],
    ['未约定的不可达原因', { kind: 'unavailable', reason: 'anything' }],
  ])('拒绝列表导航意图中的%s', async (_label, mutation) => {
    const page = buildSupplierListPage({
      suppliers: [{
        dataOrigin: 'real',
        id: 'supplier-1',
        name: '中央分供方',
        aliases: [],
        externalRef: '',
        uniqueCode: 'SUP-001',
        taxNo: '91440101TEST000001',
        businessType: '',
        supplierCategory: '材料供应商',
        rating: '',
        legalRep: '',
        registeredCapital: null,
        registeredDate: null,
        address: '',
        taxpayerType: '',
        mainBusiness: '',
        invoiceName: '',
        invoiceAddress: '',
        bank: '',
        bankAccount: '',
        phone: '',
        contact: '陈经理',
        contactPhone: '13800001234',
        contactTitle: '',
        credentialStatus: 'qualified',
        note: '',
        updatedAt: '2026-08-23T00:00:00.000Z',
      }],
      projectSuppliers: [],
      contracts: [],
      paymentApplications: [],
      paymentRecords: [],
      paymentAllocations: [],
      query: parseSupplierListQuery({}),
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['supplier:list:read'],
    })
    const malformed = structuredClone(page) as unknown as Record<string, any>
    Object.assign(malformed.items[0].navigation, mutation)
    const repository = createHttpSupplierReadRepository({
      fetcher: vi.fn().mockResolvedValue(malformed),
    })

    await expect(repository.list(parseSupplierListQuery({})))
      .rejects
      .toMatchObject<SupplierRepositoryProblem>({ problem: { code: 'internal-error' } })
  })
})
