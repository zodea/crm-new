import type { CrewWorkerReadRepository, WorkerListItemDTO } from '~/lib/crew-worker/repository'
import { describe, expect, it, vi } from 'vitest'
import { listCrewMembershipCandidates } from '~/lib/crew-worker/member-management'

function worker(id: string, name: string, crewId: string | null, crewLabel = ''): WorkerListItemDTO {
  const workerRef = { state: 'resolved' as const, entity: 'worker' as const, id, label: name, no: null }
  const crew = crewId
    ? { state: 'resolved' as const, entity: 'crew' as const, id: crewId, label: crewLabel, no: null }
    : { state: 'missing' as const, entity: 'crew' as const, label: null, no: null }
  return {
    dataOrigin: 'real',
    worker: workerRef,
    navigation: { kind: 'entity-detail', subject: workerRef, variant: 'detail', view: null, filters: { dataOrigin: 'real' } },
    trade: '泥工',
    crew,
    crewNavigation: { kind: 'none', reason: 'missing-target' },
    currentProject: { state: 'missing', entity: 'project', label: null, no: null },
    projectNavigation: { kind: 'none', reason: 'missing-target' },
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
    const listWorkers = vi.fn(async ({ page }: { page: number }) => ({
      items: page === 1
        ? [worker('worker-current', '当前成员', 'crew-target', '目标班组'), worker('worker-free', '未分组工人', null)]
        : [worker('worker-other', '其他班组工人', 'crew-other', '其他班组')],
      pagination: { page, pageSize: 100, total: 3 },
      summary: { trades: [], projectStatuses: [], origins: { real: { workerCount: 3, activeWorkerCount: 3 }, demo: { workerCount: 0, activeWorkerCount: 0 } } },
      empty: null,
      asOf: '2026-08-24T00:00:00.000Z',
      sourceVersion: 'v1',
      capabilities: ['worker:list:read', 'worker:write'],
    }))

    const candidates = await listCrewMembershipCandidates(
      { listWorkers } as unknown as CrewWorkerReadRepository,
      'crew-target',
      ['worker-current'],
    )

    expect(listWorkers).toHaveBeenCalledTimes(2)
    expect(candidates).toEqual([
      expect.objectContaining({ id: 'worker-other', currentCrewLabel: '其他班组' }),
      expect.objectContaining({ id: 'worker-free', currentCrewLabel: null }),
    ])
  })
})
