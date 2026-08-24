import type {
  ProjectSupplierRepositoryProblem,
} from '~/lib/project-supplier/repository'
import { describe, expect, it, vi } from 'vitest'
import {
  buildProjectSupplierWorkbenchRead,
  createHttpProjectSupplierReadRepository,
  parseProjectSupplierWorkbenchQuery,
} from '~/lib/project-supplier/repository'

function validRead() {
  return buildProjectSupplierWorkbenchRead({
    projects: [{ dataOrigin: 'demo', id: 'project/1', name: '中央项目', status: '在建', developer: '', manager: '' }],
    suppliers: [{ dataOrigin: 'demo', id: 'supplier/1', name: '中央分供方', supplierCategory: '材料供应商', contact: '', contactPhone: '' }],
    relations: [{ dataOrigin: 'demo', id: 'relation-1', projectId: 'project/1', supplierId: 'supplier/1', status: 'collecting', note: '' }],
    contracts: [{
      dataOrigin: 'demo',
      id: 'contract-1',
      projectId: 'project/1',
      supplierId: 'supplier/1',
      no: 'HT-001',
      name: '采购合同',
      kind: '材采',
      status: 'approved',
      amount: 10,
      supplementAmount: 0,
      signDate: '2026-08-01',
      attachmentCount: 0,
    }],
    claims: [],
    invoices: [],
    paymentRecords: [],
    paymentAllocations: [],
    settlements: [],
    files: [],
    query: parseProjectSupplierWorkbenchQuery('project/1', 'supplier/1', { origin: 'demo', includeDemo: true }),
    asOf: '2026-08-24T00:00:00.000Z',
    sourceVersion: 'fixture-v1',
    capabilities: ['project-supplier:read', 'demo:read'],
  })
}

describe('项目×分供方 HTTP Repository', () => {
  it('只通过编码后的双父 ID 端点读取并解码中央 DTO', async () => {
    const fetcher = vi.fn().mockResolvedValue(validRead())
    const repository = createHttpProjectSupplierReadRepository({ fetcher })

    const result = await repository.get({
      projectId: 'project/1',
      supplierId: 'supplier/1',
      origin: 'demo',
      includeDemo: true,
    })

    expect(result.relation.id).toBe('relation-1')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/read/project-suppliers/project%2F1/supplier%2F1',
      { query: { origin: 'demo', includeDemo: 'true' } },
    )
  })

  it('拒绝被篡改为前端路径或错误语义的来源目标', async () => {
    const malformed = structuredClone(validRead()) as Record<string, any>
    malformed.contracts[0].navigation = {
      kind: 'source-record',
      subject: malformed.contracts[0].contract,
      variant: '/contract/contract-1',
      view: null,
      filters: {},
    }
    const repository = createHttpProjectSupplierReadRepository({
      fetcher: vi.fn().mockResolvedValue(malformed),
    })

    await expect(repository.get({ projectId: 'project/1', supplierId: 'supplier/1', origin: 'demo', includeDemo: true }))
      .rejects
      .toMatchObject<ProjectSupplierRepositoryProblem>({ problem: { code: 'internal-error' } })
  })

  it('保留中央 relationship-mismatch ProblemDTO', async () => {
    const problem = {
      code: 'relationship-mismatch',
      message: '项目与分供方不存在真实合作关系',
      retryable: false,
      fieldErrors: {},
      traceId: 'trace-317',
    }
    const repository = createHttpProjectSupplierReadRepository({
      fetcher: vi.fn().mockRejectedValue({ response: { _data: { data: problem } } }),
    })

    await expect(repository.get({ projectId: 'project-1', supplierId: 'supplier-1', origin: 'real', includeDemo: false }))
      .rejects
      .toMatchObject<ProjectSupplierRepositoryProblem>({ problem })
  })
})
