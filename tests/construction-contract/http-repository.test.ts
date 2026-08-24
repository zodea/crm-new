import { describe, expect, it, vi } from 'vitest'
import { createHttpConstructionContractReadRepository } from '~/lib/construction-contract/http-repository'
import {
  buildConstructionContractListPage,
  parseConstructionContractListQuery,
} from '~/lib/construction-contract/repository'

describe('施工合同中央 HTTP Repository', () => {
  it('序列化施工专属筛选并解码中央列表', async () => {
    const query = parseConstructionContractListQuery({
      includeDemo: 'true',
      search: '中央',
      projectId: 'project-1',
      customerId: 'customer-1',
      status: '履约中',
      page: '2',
      pageSize: '20',
    })
    const page = buildConstructionContractListPage({
      contracts: [],
      facts: { supplements: [], changes: [], monthlyStatements: [], finalSettlements: [], penalties: [], invoiceApplications: [], invoiceRegistrations: [], receipts: [], acceptances: [], warranties: [], files: [] },
      query,
      asOf: '2026-08-24T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['construction-contract:read'],
    })
    const fetcher = vi.fn().mockResolvedValue(page)
    await createHttpConstructionContractReadRepository({ fetcher }).list(query)
    expect(fetcher).toHaveBeenCalledWith('/api/read/construction-contracts', {
      query: {
        includeDemo: 'true',
        origin: '',
        search: '中央',
        projectId: 'project-1',
        customerId: 'customer-1',
        status: '履约中',
        page: '2',
        pageSize: '20',
      },
    })
  })
})
