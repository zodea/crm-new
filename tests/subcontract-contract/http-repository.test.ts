import { describe, expect, it, vi } from 'vitest'
import { createHttpSubcontractContractReadRepository } from '../../app/lib/subcontract-contract/http-repository'
import {
  buildSubcontractContractListPage,
  parseSubcontractContractListQuery,
} from '../../app/lib/subcontract-contract/repository'

describe('分包合同中央 HTTP Repository', () => {
  it('序列化分包专属筛选并解码中央列表', async () => {
    const query = parseSubcontractContractListQuery({
      includeDemo: 'true',
      search: '劳务',
      projectId: 'project-1',
      supplierId: 'supplier-1',
      status: '履约中',
      subKind: '劳务',
      page: '2',
      pageSize: '20',
    })
    const page = buildSubcontractContractListPage({
      contracts: [],
      facts: { supplements: [], changes: [], invoices: [], paymentApplications: [], paymentRecords: [], settlements: [], penalties: [], files: [] },
      query,
      asOf: '2026-08-25T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['subcontract-contract:read'],
    })
    const fetcher = vi.fn().mockResolvedValue(page)

    await createHttpSubcontractContractReadRepository({ fetcher }).list(query)

    expect(fetcher).toHaveBeenCalledWith('/api/read/subcontract-contracts', {
      query: {
        includeDemo: 'true',
        origin: '',
        search: '劳务',
        projectId: 'project-1',
        supplierId: 'supplier-1',
        status: '履约中',
        subKind: '劳务',
        page: '2',
        pageSize: '20',
      },
    })
  })
})
