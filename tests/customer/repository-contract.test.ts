import type { CustomerListSourceRow } from '~/lib/customer/repository'
import { describe, expect, it } from 'vitest'
import {
  buildCustomerDetailRead,
  buildCustomerListPage,
  CustomerRepositoryProblem,
  parseCustomerDetailQuery,
  parseCustomerListQuery,
} from '~/lib/customer/repository'

const AS_OF = '2026-08-23T00:00:00.000Z'

function customer(
  id: string,
  name: string,
  overrides: Partial<CustomerListSourceRow> = {},
): CustomerListSourceRow {
  return {
    dataOrigin: 'real',
    id,
    name,
    aliases: [],
    taxNo: '',
    legalRep: '',
    registeredAddress: '',
    invoiceName: '',
    bank: '',
    bankAccount: '',
    contact: '',
    contactPhone: '',
    status: 'active',
    note: '',
    updatedAt: AS_OF,
    ...overrides,
  }
}

describe('客户中央 Repository contract', () => {
  it('按名称、别名或税号搜索并输出稳定分页与语义详情目标', () => {
    const query = parseCustomerListQuery({
      includeDemo: 'false',
      search: '合和',
      sort: 'name-asc',
      page: '1',
      pageSize: '10',
    })

    const page = buildCustomerListPage({
      rows: [
        customer('customer-2', '第二客户'),
        customer('customer-1', '合和地产集团', {
          aliases: ['合和地产'],
          taxNo: '91440101TEST',
        }),
      ],
      query,
      asOf: AS_OF,
      sourceVersion: 'customer-v1',
      capabilities: ['customer:list:read', 'customer:write'],
    })

    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      dataOrigin: 'real',
      customer: {
        state: 'resolved',
        entity: 'customer',
        id: 'customer-1',
        label: '合和地产集团',
      },
      navigation: {
        kind: 'entity-detail',
        variant: 'detail',
        filters: { dataOrigin: 'real' },
      },
    })
    expect(JSON.stringify(page.items[0]?.navigation)).not.toContain('/base/customer')
    expect(page.pagination).toEqual({ page: 1, pageSize: 10, total: 1 })
    expect(page.summary).toEqual({
      statuses: [{ value: 'active', label: 'active', count: 1 }],
      origins: {
        real: { customerCount: 1 },
        demo: { customerCount: 0 },
      },
    })
    expect(page.empty).toBeNull()
  })

  it('详情只按来源与稳定 ID 关联，并区分 resolved、missing 与 forbidden', () => {
    const detail = buildCustomerDetailRead({
      customers: [customer('customer-1', '合和地产集团')],
      projects: [
        {
          dataOrigin: 'real',
          id: 'project-1',
          name: '合和新城',
          code: 'HHXC-01',
          customerId: 'customer-1',
          secondaryCustomerId: null,
          permission: 'allowed',
          status: '施工中',
          startDate: '2026-01-01',
          plannedEnd: '2026-12-31',
          manager: '张经理',
        },
        {
          dataOrigin: 'real',
          id: 'project-secret',
          name: '不能泄露的项目',
          code: 'SECRET',
          customerId: 'customer-1',
          secondaryCustomerId: null,
          permission: 'forbidden',
          status: '',
          startDate: null,
          plannedEnd: null,
          manager: '',
        },
      ],
      contracts: [{
        dataOrigin: 'real',
        id: 'contract-1',
        no: 'SG-001',
        name: '施工合同',
        projectId: null,
        customerId: 'customer-1',
        amount: 1000000,
        supplementAmount: 50000,
        receiptAmount: 320000,
        signDate: '2026-01-02',
        status: '履约中',
      }],
      receipts: [{
        dataOrigin: 'real',
        id: 'receipt-1',
        no: 'SK-001',
        customerId: 'customer-1',
        projectId: 'project-1',
        contractId: null,
        payerAccount: '合和地产集团',
        amount: 320000,
        paymentMethod: '银行转账',
        receiptDate: '2026-05-01',
        status: 'submitted',
      }],
      query: parseCustomerDetailQuery('customer-1', {
        origin: 'real',
        includeDemo: 'false',
      }),
      asOf: AS_OF,
      sourceVersion: 'customer-v1',
      capabilities: ['customer:list:read', 'customer:write'],
    })

    expect(detail.customer.id).toBe('customer-1')
    expect(detail.projects[0]?.project).toMatchObject({
      state: 'resolved',
      id: 'project-1',
      label: '合和新城',
    })
    expect(detail.projects[0]?.navigation).toMatchObject({
      kind: 'entity-detail',
      filters: { dataOrigin: 'real', customerId: 'customer-1' },
    })
    expect(detail.projects[1]?.project).toEqual({
      state: 'forbidden',
      entity: 'project',
      id: 'project-secret',
      label: null,
      reason: 'permission-denied',
    })
    expect(detail.contracts[0]?.project).toEqual({
      state: 'missing',
      entity: 'project',
      id: null,
      label: null,
      reason: 'not-recorded',
    })
    expect(detail.receipts[0]?.contract).toEqual({
      state: 'missing',
      entity: 'contract',
      id: null,
      label: null,
      reason: 'not-recorded',
    })
    expect(detail.summary).toMatchObject({
      effectiveContractAmount: '1050000.00',
      effectiveReceiptAmount: '320000.00',
      outstandingAmount: '730000.00',
    })
  })

  it('来源不一致时返回 relationship-mismatch，不按同名客户回退', () => {
    expect(() => buildCustomerDetailRead({
      customers: [
        customer('same-id', '正式客户'),
        customer('same-id', '测试客户', { dataOrigin: 'demo' }),
      ],
      projects: [],
      contracts: [],
      receipts: [],
      query: parseCustomerDetailQuery('same-id', {
        origin: 'demo',
        includeDemo: 'false',
      }),
      asOf: AS_OF,
      sourceVersion: 'customer-v1',
      capabilities: ['customer:list:read'],
    })).toThrowError(CustomerRepositoryProblem)

    try {
      buildCustomerDetailRead({
        customers: [customer('same-id', '正式客户')],
        projects: [],
        contracts: [],
        receipts: [],
        query: parseCustomerDetailQuery('same-id', {
          origin: 'demo',
          includeDemo: 'true',
        }),
        asOf: AS_OF,
        sourceVersion: 'customer-v1',
        capabilities: ['customer:list:read'],
      })
    }
    catch (cause) {
      expect(cause).toBeInstanceOf(CustomerRepositoryProblem)
      expect((cause as CustomerRepositoryProblem).problem.code).toBe('relationship-mismatch')
    }
  })
})
