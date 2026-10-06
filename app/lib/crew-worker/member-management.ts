import type { CrewWorkerReadRepository, WorkerListPageDTO } from './repository'
import { collectReadPages } from '../read-model/collection'
import { crewWorkerProblemFromUnknown } from './read-decoder'

export interface CrewMembershipCandidate {
  id: string
  name: string
  trade: string
  currentCrewId: string | null
  currentCrewLabel: string | null
  currentProjectId: string | null
  currentProjectLabel: string | null
  optionLabel: string
}

export async function listCrewMembershipCandidates(
  repository: CrewWorkerReadRepository,
  crewId: string,
  currentMemberIds: readonly string[],
  isCurrent?: () => boolean,
): Promise<CrewMembershipCandidate[]> {
  const excluded = new Set(currentMemberIds)
  const { items: rows } = await collectReadPages<WorkerListPageDTO>({
    isCurrent,
    load: page => repository.listWorkers({
      includeDemo: false,
      search: '',
      trade: null,
      crewId: null,
      projectStatus: null,
      status: null,
      sort: 'name-asc',
      page,
      pageSize: 100,
    }),
    identity: item => `${item.dataOrigin}:${item.worker.id}`,
  }).catch((cause) => { throw crewWorkerProblemFromUnknown(cause) })

  const candidates = rows
    .filter(row => row.dataOrigin === 'real' && !excluded.has(row.worker.id))
    .map((row) => {
      const currentCrew = row.crew.state === 'resolved' ? row.crew : null
      const currentCrewId = currentCrew?.id ?? null
      const currentCrewLabel = currentCrew?.label ?? null
      const currentProject = row.currentProject.state === 'resolved' ? row.currentProject : null
      return {
        id: row.worker.id,
        name: row.worker.label,
        trade: row.trade,
        currentCrewId,
        currentCrewLabel,
        currentProjectId: currentProject?.id ?? null,
        currentProjectLabel: currentProject?.label ?? null,
        optionLabel: `${row.worker.label} · ${row.trade || '未记录工种'} · ${currentCrewLabel ?? '未分组'}${currentProject ? ` · 当前项目：${currentProject.label}` : ''}`,
      }
    })
    .filter(candidate => candidate.currentCrewId !== crewId)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id))

  const duplicateLabels = new Set<string>()
  const seenLabels = new Set<string>()
  for (const candidate of candidates) {
    if (seenLabels.has(candidate.optionLabel))
      duplicateLabels.add(candidate.optionLabel)
    seenLabels.add(candidate.optionLabel)
  }
  return candidates.map(candidate => duplicateLabels.has(candidate.optionLabel)
    ? { ...candidate, optionLabel: `${candidate.optionLabel} · ${candidate.id}` }
    : candidate)
}
