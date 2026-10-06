import { describe, expect, it } from 'vitest'
import { createHttpCrewWorkerReadRepository } from '~/lib/crew-worker/http-repository'
import { parseCrewDetailQuery, parseCrewListQuery, parseWorkerDetailQuery, parseWorkerListQuery } from '~/lib/crew-worker/repository'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta } from '~/lib/read-model/meta'
import { crewWorkerReadTestInstance } from '../../server/utils/crew-worker-read-test-instance'

const domains = [
  { kind: 'crew', list: crewWorkerReadTestInstance.listCrews, detail: crewWorkerReadTestInstance.crewDetail, query: parseCrewListQuery, detailQuery: parseCrewDetailQuery },
  { kind: 'worker', list: crewWorkerReadTestInstance.listWorkers, detail: crewWorkerReadTestInstance.workerDetail, query: parseWorkerListQuery, detailQuery: parseWorkerDetailQuery },
] as const

describe('班组工人可信读取证据', () => {
  it.each(domains)('$kind 实际owner版本和读取点，跨页同范围且未请求demo未知', async (domain) => {
    const start = Date.now()
    const real = await domain.list({ includeDemo: false }, 'crew-meta')
    expect(hasConsistentOriginReadMeta(real, 'crew-worker-read-v2')).toBe(true)
    expect(Date.parse(real.asOf)).toBeGreaterThanOrEqual(start)
    expect(real.meta.workspaceId).toBe('workspace-default')
    expect(real.meta.actorId).toBe('actor-default')
    expect(real.originMeta.demo.sourceVersion).toBeNull()
    expect(real.originMeta.demo.authorizedScope.coverage).toBe('unknown')
    expect(real.originMeta.demo.sources).toEqual([{ key: 'crew-workers', state: 'not-requested', sourceVersion: null, asOf: null }, { key: 'projects', state: 'not-requested', sourceVersion: null, asOf: null }])
    const first = await domain.list({ includeDemo: true, page: 1, pageSize: 10 }, 'crew-meta')
    const later = await domain.list({ includeDemo: true, page: 40, pageSize: 20 }, 'crew-meta')
    expect(later.pagination.requestedPage).toBe(40)
    expect(later.pagination.page).toBeLessThan(40)
    expect(later.meta.sourceVersion).toBe(first.meta.sourceVersion)
    expect(later.meta.authorizedScope).toEqual(first.meta.authorizedScope)
    const item = first.items[0]!
    const id = domain.kind === 'crew' ? ('crew' in item && item.crew.id) : ('worker' in item && item.worker.id)
    const detail = await domain.detail(String(id), { includeDemo: true, origin: item.dataOrigin }, 'crew-meta')
    expect(hasConsistentReadMeta(detail, 'crew-worker-read-v2', item.dataOrigin)).toBe(true)
  })

  it.each(domains)('$kind HTTP拒绝无证据、错页大小、错目标来源和跨身份index', async (domain) => {
    const page = await domain.list({ includeDemo: true, page: 30, pageSize: 10 }, 'crew-meta')
    let wire: unknown = page
    const repository = createHttpCrewWorkerReadRepository({ fetcher: async () => wire })
    const list = domain.kind === 'crew' ? repository.listCrews : repository.listWorkers
    const query = domain.query({ includeDemo: true, page: 30, pageSize: 10 })
    await expect(list(query as never)).resolves.toEqual(page)
    const { meta: _meta, originMeta: _origin, ...old } = page
    for (const bad of [old, { ...page, pagination: { ...page.pagination, requestedPage: 29 } }, { ...page, pagination: { ...page.pagination, pageSize: 20 } }, { ...page, sourceVersion: 'unrelated' }, { ...page, originMeta: { ...page.originMeta, demo: { ...page.originMeta.demo, actorId: 'other' } } }]) {
      wire = bad
      await expect(list(query as never)).rejects.toBeDefined()
    }
    const item = page.items[0]!
    const id = domain.kind === 'crew' ? ('crew' in item && item.crew.id) : ('worker' in item && item.worker.id)
    const detail = await domain.detail(String(id), { includeDemo: true, origin: item.dataOrigin }, 'crew-meta')
    wire = detail
    const get = domain.kind === 'crew' ? repository.getCrew : repository.getWorker
    await expect(get(domain.detailQuery(String(id), { includeDemo: true, origin: item.dataOrigin }))).resolves.toEqual(detail)
    await expect(get(domain.detailQuery('other-id', { includeDemo: true, origin: item.dataOrigin }))).rejects.toBeDefined()
    await expect(get(domain.detailQuery(String(id), { includeDemo: true, origin: item.dataOrigin === 'demo' ? 'real' : 'demo' }))).rejects.toBeDefined()
  })
})
