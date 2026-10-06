import { describe, expect, it, vi } from 'vitest'
import { createHttpSubcontractContractCommandRepository } from '../../app/lib/subcontract-contract/command-http-repository'
import { createHttpSubcontractContractReadRepository } from '../../app/lib/subcontract-contract/http-repository'
import {
  buildSubcontractContractListPage,
  parseSubcontractContractListQuery,
} from '../../app/lib/subcontract-contract/repository'
import { withOriginReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

describe('分包合同中央 HTTP Repository', () => {
  it('原提交核对仅上传commandId并拒绝未知、错键或失效回执', async () => {
    const result = { id: 'subcontract-1', commandId: 'original-command', version: '1', updatedAt: '2026-10-04T00:00:00.000Z', attachmentIds: [] }
    const fetcher = vi.fn().mockResolvedValue({ outcome: 'applied', result })
    const repository = createHttpSubcontractContractCommandRepository({ fetcher })
    await expect(repository.resolve('original-command')).resolves.toEqual({ outcome: 'applied', result })
    expect(fetcher).toHaveBeenCalledWith('/api/commands/subcontract-contracts/resolve', { method: 'POST', body: { commandId: 'original-command' } })
    fetcher.mockResolvedValue({ outcome: 'not-applied', commandId: 'original-command' })
    await expect(repository.resolve('original-command')).resolves.toEqual({ outcome: 'not-applied', commandId: 'original-command' })
    for (const invalid of [{ outcome: 'not-applied', commandId: 'another-command' }, { outcome: 'unknown' }, { outcome: 'applied', result: { ...result, commandId: 'another-command' } }, { outcome: 'applied', result: { ...result, id: '' } }, { outcome: 'applied', result: { ...result, version: '' } }, { outcome: 'applied', result: { ...result, updatedAt: 'invalid' } }]) {
      fetcher.mockResolvedValue(invalid)
      await expect(repository.resolve('original-command')).rejects.toMatchObject({ problem: { code: 'internal-error' } })
    }
    fetcher.mockRejectedValue({ statusCode: 404 })
    await expect(repository.resolve('original-command')).rejects.toBeDefined()
  })
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
    const evidence = { schemaVersion: 'subcontract-contract-read-v2', asOf: '2026-08-25T00:00:00.000Z', sourceVersion: 'v1', capabilities: ['subcontract-contract:read'], scope: query, requested: true }
    const fetcher = vi.fn().mockResolvedValue(withOriginReadMeta(page, { real: publicReadMeta({ ...evidence, dataOrigin: 'real' }), demo: publicReadMeta({ ...evidence, dataOrigin: 'demo' }) }))

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
