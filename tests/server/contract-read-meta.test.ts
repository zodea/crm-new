import { describe, expect, it } from 'vitest'
import { createHttpConstructionContractReadRepository } from '~/lib/construction-contract/http-repository'
import { parseConstructionContractDetailQuery, parseConstructionContractListQuery } from '~/lib/construction-contract/repository'
import { createHttpOwnerCommercialDocumentReadRepository } from '~/lib/owner-document/central-http-repository'
import { parseOwnerCommercialDocumentDetailQuery, parseOwnerCommercialDocumentListQuery } from '~/lib/owner-document/central-repository'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '~/lib/read-model/meta'
import { createHttpSubcontractContractReadRepository } from '~/lib/subcontract-contract/http-repository'
import { parseSubcontractContractDetailQuery, parseSubcontractContractListQuery } from '~/lib/subcontract-contract/repository'
import { constructionContractReadTestInstance } from '../../server/utils/construction-contract-read-test-instance'
import { ownerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'
import { subcontractContractReadTestInstance } from '../../server/utils/subcontract-contract-read-test-instance'

const domains = [
  { name: 'construction-contract', list: (input: Record<string, unknown>) => constructionContractReadTestInstance.list(input, 'contract-meta'), detail: (id: string) => constructionContractReadTestInstance.detail(id, { origin: 'demo', includeDemo: true }, 'contract-meta'), query: parseConstructionContractListQuery, getQuery: (id: string) => parseConstructionContractDetailQuery(id, { origin: 'demo', includeDemo: true }), repository: createHttpConstructionContractReadRepository },
  { name: 'subcontract-contract', list: (input: Record<string, unknown>) => subcontractContractReadTestInstance.list(input, 'contract-meta'), detail: (id: string) => subcontractContractReadTestInstance.detail(id, { origin: 'demo', includeDemo: true }, 'contract-meta'), query: parseSubcontractContractListQuery, getQuery: (id: string) => parseSubcontractContractDetailQuery(id, { origin: 'demo', includeDemo: true }), repository: createHttpSubcontractContractReadRepository },
  { name: 'owner-document', list: (input: Record<string, unknown>) => ownerCommercialDocumentReadTestInstance.list('owner_change', input, 'contract-meta'), detail: (id: string) => ownerCommercialDocumentReadTestInstance.detail('owner_change', id, { origin: 'demo', includeDemo: true }, 'contract-meta'), query: (input: Record<string, unknown>) => parseOwnerCommercialDocumentListQuery('owner_change', input), getQuery: (id: string) => parseOwnerCommercialDocumentDetailQuery('owner_change', id, { origin: 'demo', includeDemo: true }), repository: createHttpOwnerCommercialDocumentReadRepository },
] as const

describe('合同与商务单据可信读取证据', () => {
  it.each(domains)('$name 读取时点真实，未请求demo无版本；跨页范围与owner版本保持同代', async (domain) => {
    const start = Date.now()
    const real = domain.list({ includeDemo: false })
    expect(hasConsistentOriginReadMeta(real, `${domain.name}-read-v2`)).toBe(true)
    expect(Date.parse(real.asOf)).toBeGreaterThanOrEqual(start)
    expect(real.meta.workspaceId).toBe('workspace-default')
    expect(real.meta.actorId).toBe('actor-default')
    const sourceKeys = domain.name === 'construction-contract' ? ['construction-contracts', 'owner-commercial-documents'] : domain.name === 'subcontract-contract' ? ['subcontract-contracts', 'subcontract-documents'] : ['owner-documents']
    expect(real.originMeta.demo.sources).toEqual(sourceKeys.map(key => ({ key, state: 'not-requested', sourceVersion: null, asOf: null })))
    expect(real.originMeta.demo.sourceVersion).toBeNull()
    expect(real.originMeta.demo.authorizedScope.coverage).toBe('unknown')
    const first = domain.list({ includeDemo: true, origin: 'demo', page: 1, pageSize: 10 })
    const next = domain.list({ includeDemo: true, origin: 'demo', page: 5, pageSize: 20 })
    expect(next.pagination.requestedPage).toBe(5)
    expect(next.pagination.page).toBeLessThan(5)
    expect(first.meta.dataOrigin).toBe('demo')
    expect(first.meta.sourceVersion).toBe(next.meta.sourceVersion)
    expect(first.meta.authorizedScope).toEqual(next.meta.authorizedScope)
    expect(first.items.length).toBeGreaterThan(0)
    const id = first.items[0]!.id
    const detail = domain.detail(id)
    expect(hasConsistentReadMeta(detail, `${domain.name}-read-v2`, 'demo')).toBe(true)
  })

  it.each(domains)('$name HTTP拒绝旧schema、跨页响应、错误size、错目标或错来源', async (domain) => {
    const query = domain.query({ includeDemo: true, origin: 'demo', page: 5, pageSize: 10 })
    const page = domain.list({ includeDemo: true, origin: 'demo', page: 5, pageSize: 10 })
    let wire: unknown = page
    const repository = domain.repository({ fetcher: async () => wire }) as { list: (query: any) => Promise<unknown>, get: (query: any) => Promise<unknown> }
    await expect(repository.list(query)).resolves.toEqual(page)
    const { meta: _meta, originMeta: _originMeta, ...old } = page
    for (const bad of [old, { ...page, pagination: { ...page.pagination, requestedPage: 4 } }, { ...page, pagination: { ...page.pagination, pageSize: 20 } }, { ...page, sourceVersion: 'unrelated-flat-version' }, { ...page, originMeta: { ...page.originMeta, demo: { ...page.originMeta.demo, actorId: 'other-actor' } } }]) {
      wire = bad
      await expect(repository.list(query)).rejects.toBeDefined()
    }
    const detail = domain.detail(page.items[0]!.id)
    wire = detail
    await expect(repository.get(domain.getQuery(page.items[0]!.id))).resolves.toEqual(detail)
    await expect(repository.get(domain.getQuery('another-target'))).rejects.toBeDefined()
    await expect(repository.get({ ...domain.getQuery(page.items[0]!.id), origin: 'real' })).rejects.toBeDefined()
  })
})
