import type { CrewWorkerProjectSourceRow, WorkerSourceRow } from '~/lib/crew-worker/read-contract'
import { describe, expect, it } from 'vitest'
import { decodeWorkerDetailRead } from '~/lib/crew-worker/read-decoder'
import { buildWorkerDetailRead } from '~/lib/crew-worker/read-page'
import { withReadMeta } from '../../server/utils/read-meta'
import { publicReadMeta } from '../helpers/public-read-meta'

const worker: WorkerSourceRow = { dataOrigin: 'real', id: 'worker-readable', crewId: null, currentProjectId: 'project-restricted', name: '可读工人', trade: '泥工', phone: '', idCard: '', projectStatus: '在场', entryDate: null, exitDate: null, safetyEducation: true, status: 'submitted', updatedAt: '2026-10-04T00:00:00.000Z' }
const project: CrewWorkerProjectSourceRow = { dataOrigin: 'real', id: 'project-restricted', name: '受限项目名称', code: 'PRIVATE-PROJECT-NO', status: '施工中', permission: 'forbidden' }
const input = { crews: [], workers: [worker], projects: [project], assignments: [{ dataOrigin: 'real' as const, id: 'assignment-readable', workerId: worker.id, crewId: null, projectId: project.id, unitId: 'unit-readable', unitName: '独立已知计量部位', completedStageCount: 2 }], wages: [], penalties: [], query: { id: worker.id, origin: 'real' as const, includeDemo: false }, asOf: '2026-10-04T00:00:00.000Z', sourceVersion: 'reference-test', capabilities: ['worker:list:read'] }

describe('工人详情的受限项目引用投影', () => {
  it('公共详情不从raw外键、项目编号或计量导航重新下发身份，原事实及计量记录保留', () => {
    const detail = withReadMeta(buildWorkerDetailRead(input), publicReadMeta({ ...input, schemaVersion: 'crew-worker-read-v2', dataOrigin: 'real', requested: true, scope: input.query }))
    expect(detail.worker.currentProjectId).toBeNull()
    expect(detail.projects[0]!.project).toEqual({ state: 'forbidden', entity: 'project', id: null, label: null, reason: 'permission-denied' })
    expect(detail.projects[0]).toMatchObject({ code: '', status: '' })
    expect(detail.assignments[0]!.navigation).toEqual({ kind: 'unavailable', reason: 'forbidden' })
    expect(detail.assignments[0]!.completedStageCount).toBe(2)
    expect(detail.summary.completedStageCount).toBe(2)
    expect(JSON.stringify(detail)).not.toContain(project.id)
    expect(JSON.stringify(detail)).not.toContain(project.name)
    expect(JSON.stringify(detail)).not.toContain(project.code)
    expect(decodeWorkerDetailRead(detail).worker.id).toBe('worker-readable')
    expect(worker.currentProjectId).toBe('project-restricted')
    const recovered = buildWorkerDetailRead({ ...input, projects: [{ ...project, permission: 'allowed' }] })
    expect(recovered.worker.currentProjectId).toBe('project-restricted')
    expect(recovered.assignments[0]!.navigation).toMatchObject({ kind: 'entity-detail', filters: { projectId: 'project-restricted' } })
  })

  it('decoder拒绝公共详情携带隐藏 raw 外键、额外导航定位及受限项目编号', () => {
    const detail = withReadMeta(buildWorkerDetailRead(input), publicReadMeta({ ...input, schemaVersion: 'crew-worker-read-v2', dataOrigin: 'real', requested: true, scope: input.query }))
    const broken = [
      { ...detail, worker: { ...detail.worker, currentProjectId: 'project-restricted' } },
      { ...detail, projects: [{ ...detail.projects[0], project: { ...detail.projects[0]!.project, id: 'project-restricted' } }] },
      { ...detail, projects: [{ ...detail.projects[0], code: 'PRIVATE-PROJECT-NO' }] },
      { ...detail, assignments: [{ ...detail.assignments[0], navigation: { kind: 'unavailable', reason: 'forbidden', filters: { projectId: 'project-restricted' } } }] },
    ]
    for (const payload of broken)
      expect(() => decodeWorkerDetailRead(payload)).toThrow('无效')
  })
})
