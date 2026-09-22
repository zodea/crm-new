import type { CrewWorkerReadRepository } from './repository'

export interface CrewMembershipCandidate {
  id: string
  name: string
  trade: string
  currentCrewId: string | null
  currentCrewLabel: string | null
  optionLabel: string
}

export async function listCrewMembershipCandidates(
  repository: CrewWorkerReadRepository,
  crewId: string,
  currentMemberIds: readonly string[],
): Promise<CrewMembershipCandidate[]> {
  const excluded = new Set(currentMemberIds)
  const rows = []
  let page = 1
  let total = Number.POSITIVE_INFINITY

  while (rows.length < total) {
    const result = await repository.listWorkers({
      includeDemo: false,
      search: '',
      trade: null,
      crewId: null,
      projectStatus: null,
      status: null,
      sort: 'name-asc',
      page,
      pageSize: 100,
    })
    rows.push(...result.items)
    total = result.pagination.total
    if (!result.items.length)
      break
    page += 1
  }

  const candidates = rows
    .filter(row => row.dataOrigin === 'real' && !excluded.has(row.worker.id))
    .map((row) => {
      const currentCrew = row.crew.state === 'resolved' ? row.crew : null
      const currentCrewId = currentCrew?.id ?? null
      const currentCrewLabel = currentCrew?.label ?? null
      return {
        id: row.worker.id,
        name: row.worker.label,
        trade: row.trade,
        currentCrewId,
        currentCrewLabel,
        optionLabel: `${row.worker.label} · ${row.trade || '未记录工种'} · ${currentCrewLabel ?? '未分组'}`,
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
