import { describe, expect, it, vi } from 'vitest'
import { createHttpCrewWorkerReadRepository } from '~/lib/crew-worker/http-repository'
import { CrewWorkerRepositoryProblem } from '~/lib/crew-worker/repository'
import { withOriginReadMeta, withReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

describe('班组—工人中央 HTTP Repository', () => {
  it('序列化班组列表查询并严格解码中央分页响应', async () => {
    const evidence = { schemaVersion: 'crew-worker-read-v2', asOf: '2026-08-23T00:00:00.000Z', sourceVersion: 'crew-worker-v1', capabilities: ['crew:list:read'], scope: { fixture: 'crew-list' }, requested: true }
    const fetcher = vi.fn(async () => withOriginReadMeta({
      items: [{
        dataOrigin: 'real',
        crew: { state: 'resolved', entity: 'crew', id: 'crew-1', label: '泥水一组', no: null },
        navigation: {
          kind: 'entity-detail',
          subject: { state: 'resolved', entity: 'crew', id: 'crew-1', label: '泥水一组', no: null },
          variant: 'detail',
          view: null,
          filters: { dataOrigin: 'real' },
        },
        trade: '泥工',
        contactName: '陈师傅',
        contactPhone: '138 **** 5678',
        memberCount: 2,
        activeMemberCount: 1,
        projectCount: 2,
        status: 'submitted',
        updatedAt: '2026-08-20T00:00:00.000Z',
      }],
      pagination: { requestedPage: 1, page: 1, pageSize: 10, total: 1 },
      summary: {
        trades: [{ value: '泥工', label: '泥工', count: 1 }],
        statuses: [{ value: 'submitted', label: 'submitted', count: 1 }],
        origins: { real: { crewCount: 1, workerCount: 2 }, demo: { crewCount: 0, workerCount: 0 } },
      },
      empty: null,
      asOf: '2026-08-23T00:00:00.000Z',
      sourceVersion: 'crew-worker-v1',
      capabilities: ['crew:list:read'],
    }, { real: publicReadMeta({ ...evidence, dataOrigin: 'real' }), demo: publicReadMeta({ ...evidence, dataOrigin: 'demo', requested: false }) }))
    const repository = createHttpCrewWorkerReadRepository({ fetcher })

    const page = await repository.listCrews({
      includeDemo: false,
      search: '泥水',
      trade: null,
      status: null,
      sort: 'updated-desc',
      page: 1,
      pageSize: 10,
    })

    expect(fetcher).toHaveBeenCalledWith('/api/read/crews', {
      query: {
        includeDemo: 'false',
        search: '泥水',
        trade: '',
        status: '',
        sort: 'updated-desc',
        page: '1',
        pageSize: '10',
      },
    })
    expect(page.items[0]?.crew.id).toBe('crew-1')
  })

  it('中央响应形状错误时拒绝进入页面 store', async () => {
    const repository = createHttpCrewWorkerReadRepository({
      fetcher: async () => ({ items: [{ id: 'crew-1', name: '伪造旧形状' }] }),
    })

    await expect(repository.listCrews({
      includeDemo: false,
      search: '',
      trade: null,
      status: null,
      sort: 'updated-desc',
      page: 1,
      pageSize: 10,
    })).rejects.toBeInstanceOf(CrewWorkerRepositoryProblem)
  })

  it('读取关系事实的真实归属，不依赖地址中的 owner 猜测', async () => {
    const evidence = { schemaVersion: 'crew-worker-read-v2', asOf: '2026-08-23T00:00:00.000Z', sourceVersion: 'wage-fixture-v1', capabilities: ['crew:list:read', 'worker:list:read', 'demo:read'], scope: { fixture: 'wage-identity' }, requested: true, dataOrigin: 'demo' as const }
    const fetcher = vi.fn(async () => withReadMeta({
      kind: 'wage',
      id: 'wage-1',
      dataOrigin: 'demo',
      projectId: 'project-1',
      owners: [{ kind: 'crew', id: 'crew-1' }, { kind: 'worker', id: 'worker-1' }],
    }, publicReadMeta(evidence)))
    const repository = createHttpCrewWorkerReadRepository({ fetcher })

    await expect(repository.getRelationFactIdentity({ kind: 'wage', id: 'wage-1', origin: 'demo', includeDemo: true }))
      .resolves
      .toMatchObject({ owners: [{ kind: 'crew', id: 'crew-1' }, { kind: 'worker', id: 'worker-1' }] })
    expect(fetcher).toHaveBeenCalledWith('/api/read/crew-worker-facts/wage/wage-1', {
      query: { origin: 'demo', includeDemo: 'true' },
    })
  })
})
