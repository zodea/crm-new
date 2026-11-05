import { describe, expect, it, vi } from 'vitest'
import { createHttpConstructionContractCommandRepository } from '~/lib/construction-contract/command-http-repository'
import { createHttpConstructionContractReadRepository } from '~/lib/construction-contract/http-repository'
import {
  buildConstructionContractListPage,
  parseConstructionContractListQuery,
} from '~/lib/construction-contract/repository'
import { withOriginReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

describe('施工合同中央 HTTP Repository', () => {
  it('原提交核对仅上传commandId，严格绑定回执或未应用证明，不把404当未应用', async () => {
    const result = { id: 'construction-1', commandId: 'original-command', version: '1', updatedAt: '2026-10-04T00:00:00.000Z', attachmentIds: [] }
    const fetcher = vi.fn().mockResolvedValue({ outcome: 'applied', result })
    const repository = createHttpConstructionContractCommandRepository({ fetcher })
    await expect(repository.resolve('original-command')).resolves.toEqual({ outcome: 'applied', result })
    expect(fetcher).toHaveBeenCalledWith('/api/commands/construction-contracts/resolve', { method: 'POST', body: { commandId: 'original-command' } })
    fetcher.mockResolvedValue({ outcome: 'not-applied', commandId: 'original-command' })
    await expect(repository.resolve('original-command')).resolves.toEqual({ outcome: 'not-applied', commandId: 'original-command' })
    for (const invalid of [{ outcome: 'not-applied', commandId: 'another-command' }, { outcome: 'unknown' }, { outcome: 'applied', result: { ...result, commandId: 'another-command' } }, { outcome: 'applied', result: { ...result, id: '' } }, { outcome: 'applied', result: { ...result, version: '' } }, { outcome: 'applied', result: { ...result, updatedAt: 'invalid' } }]) {
      fetcher.mockResolvedValue(invalid)
      await expect(repository.resolve('original-command')).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    }
    fetcher.mockRejectedValue({ statusCode: 404 })
    await expect(repository.resolve('original-command')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  })
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
    const evidence = { schemaVersion: 'construction-contract-read-v2', asOf: '2026-08-24T00:00:00.000Z', sourceVersion: 'v1', capabilities: ['construction-contract:read'], scope: query, requested: true }
    const fetcher = vi.fn().mockResolvedValue(withOriginReadMeta(page, { real: publicReadMeta({ ...evidence, dataOrigin: 'real' }), demo: publicReadMeta({ ...evidence, dataOrigin: 'demo' }) }))
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
