import type { CrewWorkerReadRepository, WorkerListItemDTO } from '~/lib/crew-worker/repository'
import { describe, expect, it, vi } from 'vitest'
import { listCrewMembershipCandidates } from '~/lib/crew-worker/member-management'
import { withOriginReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

function worker(id: string, name: string, crewId: string | null, crewLabel = ''): WorkerListItemDTO {
  const workerRef = { state: 'resolved' as const, entity: 'worker' as const, id, label: name, no: null }
  const crew = crewId
    ? { state: 'resolved' as const, entity: 'crew' as const, id: crewId, label: crewLabel, no: null }
    : { state: 'missing' as const, entity: 'crew' as const, id: null, label: null, reason: 'not-recorded' as const }
  return {
    dataOrigin: 'real',
    worker: workerRef,
    navigation: { kind: 'entity-detail', subject: workerRef, variant: 'detail', view: null, filters: { dataOrigin: 'real' } },
    trade: '泥工',
    crew,
    crewNavigation: crew.state === 'resolved' ? { kind: 'entity-detail', subject: crew, variant: 'detail', view: null, filters: { dataOrigin: 'real' } } : { kind: 'unavailable', reason: 'missing-id' },
    currentProject: { state: 'missing', entity: 'project', id: null, label: null, reason: 'not-recorded' },
    projectNavigation: { kind: 'unavailable', reason: 'missing-id' },
    projectStatus: '在场',
    status: 'submitted',
    phone: '138 **** 0000',
    idCard: '4401 **** 0000',
    entryDate: null,
    exitDate: null,
    safetyEducation: true,
    updatedAt: '2026-08-24T00:00:00.000Z',
  }
}

describe('班组成员关系命令', () => {
  it('分页读取全部正式工人，排除当前成员并保留转组提示', async () => {
    const existingIds = Array.from({ length: 98 }, (_, index) => `current-${index}`)
    const evidence = { schemaVersion: 'crew-worker-read-v2', asOf: '2026-08-24T00:00:00.000Z', sourceVersion: 'worker-owner-v1', capabilities: ['worker:list:read', 'worker:write'], scope: { operation: 'membership-candidates', origin: 'real' }, requested: true }
    const listWorkers = vi.fn(async ({ page }: { page: number }) => withOriginReadMeta({
      items: page === 1
        ? [...existingIds.map(id => worker(id, id, 'crew-target', '目标班组')), worker('worker-current', '当前成员', 'crew-target', '目标班组'), worker('worker-free', '未分组工人', null)]
        : [worker('worker-other', '其他班组工人', 'crew-other', '其他班组')],
      pagination: { requestedPage: page, page, pageSize: 100, total: 101 },
      summary: { trades: [], projectStatuses: [], origins: { real: { workerCount: 101, activeWorkerCount: 101 }, demo: { workerCount: 0, activeWorkerCount: 0 } } },
      empty: null,
      asOf: '2026-08-24T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['worker:list:read', 'worker:write'],
    }, { real: publicReadMeta({ ...evidence, dataOrigin: 'real' }), demo: publicReadMeta({ ...evidence, dataOrigin: 'demo', requested: false }) }))

    const candidates = await listCrewMembershipCandidates(
      { listWorkers } as unknown as CrewWorkerReadRepository,
      'crew-target',
      [...existingIds, 'worker-current'],
    )

    expect(listWorkers).toHaveBeenCalledTimes(2)
    expect(candidates).toEqual([
      expect.objectContaining({ id: 'worker-other', currentCrewLabel: '其他班组' }),
      expect.objectContaining({ id: 'worker-free', currentCrewLabel: null }),
    ])
  })
  it('跨项目选择复用原工人ID，同名档案不合并，无权项目不泄露且不按当前项目截断', async () => {
    const first = worker('worker-in-other-project', '张同名', null)
    first.currentProject = { state: 'resolved', entity: 'project', id: 'project-other', label: '另一个在建项目', no: null }
    const duplicate = worker('worker-second-person', '张同名', null)
    duplicate.currentProject = first.currentProject
    const hidden = worker('worker-hidden-project', '李工', null)
    hidden.currentProject = { state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied' }
    const rows = [first, duplicate, hidden]
    const asOf = '2026-08-24T00:00:00.000Z'
    const evidence = { schemaVersion: 'crew-worker-read-v2', asOf, sourceVersion: 'same-global-worker-owner', capabilities: ['worker:list:read', 'worker:write'], scope: { operation: 'global-membership-selection' } }
    const listWorkers = vi.fn(async ({ page }: { page: number }) => withOriginReadMeta({
      items: rows,
      pagination: { requestedPage: page, page, pageSize: 100, total: 3 },
      summary: { trades: [], projectStatuses: [], origins: { real: { workerCount: 3, activeWorkerCount: 3 }, demo: { workerCount: 0, activeWorkerCount: 0 } } },
      empty: null,
      asOf,
      sourceVersion: 'same-global-worker-owner',
      capabilities: ['worker:list:read', 'worker:write'],
    }, { real: publicReadMeta({ ...evidence, dataOrigin: 'real', requested: true }), demo: publicReadMeta({ ...evidence, dataOrigin: 'demo', requested: false }) }))
    const candidates = await listCrewMembershipCandidates({ listWorkers } as unknown as CrewWorkerReadRepository, 'crew-new-project', [])
    expect(listWorkers).toHaveBeenCalledWith({ includeDemo: false, search: '', trade: null, crewId: null, projectStatus: null, status: null, sort: 'name-asc', page: 1, pageSize: 100 })
    expect(candidates.filter(row => row.name === '张同名').map(row => row.id)).toEqual(['worker-in-other-project', 'worker-second-person'])
    expect(candidates.filter(row => row.name === '张同名').every(row => row.optionLabel.includes('另一个在建项目') && row.optionLabel.endsWith(row.id))).toBe(true)
    expect(candidates.find(row => row.id === hidden.worker.id)).toMatchObject({ currentProjectId: null, currentProjectLabel: null, optionLabel: '李工 · 泥工 · 未分组' })
    expect(first.currentProject.id).toBe('project-other')
    expect(rows).toHaveLength(3)
  })
})
