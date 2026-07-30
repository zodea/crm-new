import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { select } from '~/lib/db/connection'
import {
  hiddenCtes,
  hiddenCtesFor,
  selectVisibleSql,
  visibleCond,
} from '~/lib/db/soft-delete'
import { parseJsonColumn } from '~/lib/util/json'

export interface CrewDetailMaster {
  id: string
  name: string
  trade: string
  tradeCapabilities: readonly string[]
  itemCapabilities: readonly string[]
  contactName: string
  contactPhone: string
  defaultPayRatio: number
  rentSubsidyEnabled: boolean
  rentSubsidyPrice: number | null
  mgmtFeeEnabled: boolean
  mgmtFeePrice: number | null
  assignmentLevel: 'crew' | 'worker'
  note: string
  status: string
}

export interface CrewDetailMember {
  id: string
  name: string
  trade: string
  phone: string
  projectStatus: string
  currentProjectId: string | null
  currentProjectName: string
  entryDate: string
  dailyWage: number | null
  linkedWorkerId: string | null
  linkedWorkerName: string
}

export type CrewProjectSource = '在场成员' | '工程量责任' | '工资单'

export interface CrewProjectAssociation {
  projectId: string
  projectName: string
  projectCode: string
  projectStatus: string
  sources: readonly CrewProjectSource[]
  activeMemberCount: number
  assignmentCount: number
  assignedUnitCount: number
  completedStageCount: number
  wageStatementCount: number
  wageGrossAmount: number
  releasedWageAmount: number
}

export interface CrewPenaltyRecord {
  id: string
  no: string
  projectId: string | null
  projectName: string
  source: string
  sourceLabel: string
  location: string
  reason: string
  amount: number
  penaltyDate: string
  status: string
  statusLabel: string
}

export interface CrewDetailSummary {
  memberCount: number
  activeMemberCount: number
  projectCount: number
  assignedUnitCount: number
  completedStageCount: number
  wageStatementCount: number
  releasedWageAmount: number
  penaltyAmount: number
}

export interface CrewDetailSnapshot {
  crew: CrewDetailMaster
  members: readonly CrewDetailMember[]
  projects: readonly CrewProjectAssociation[]
  penalties: readonly CrewPenaltyRecord[]
  summary: CrewDetailSummary
}

interface AssignmentProjectRow {
  project_id: string
  project_name: string
  project_code: string
  project_status: string
  assignment_count: number
  assigned_unit_count: number
  completed_stage_count: number
}

interface WageProjectRow {
  project_id: string
  project_name: string
  project_code: string
  project_status: string
  statement_count: number
  gross_amount: number
  released_amount: number
}

const PROJECT_SOURCE_ORDER: readonly CrewProjectSource[] = [
  '在场成员',
  '工程量责任',
  '工资单',
]

const PENALTY_SOURCE_LABEL: Record<string, string> = {
  inspection: '管理巡检',
  owner_notice: '甲方/监理联系单',
  acceptance: '完工验收',
  project: '项目处罚',
}

const PENALTY_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待处理',
  repairing: '整改中',
  repaired_self: '自行修复',
  repaired_other: '他人代修',
  deducted: '已扣罚',
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableString(value: unknown): string | null {
  const result = stringValue(value)
  return result || null
}

function numberValue(value: unknown): number {
  const result = Number(value ?? 0)
  return Number.isFinite(result) ? result : 0
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '')
    return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function uniqueCapabilities(mainTrade: string, raw: unknown): string[] {
  return [...new Set([
    mainTrade,
    ...parseJsonColumn<string[]>(raw, []),
  ].map(value => value.trim()).filter(Boolean))]
}

function rowToCrew(row: Record<string, unknown>): CrewDetailMaster {
  const trade = stringValue(row.trade)
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    trade,
    tradeCapabilities: uniqueCapabilities(trade, row.trade_capabilities),
    itemCapabilities: uniqueCapabilities('', row.item_capabilities),
    contactName: stringValue(row.contact_name),
    contactPhone: stringValue(row.contact_phone),
    defaultPayRatio: numberValue(row.default_pay_ratio),
    rentSubsidyEnabled: numberValue(row.rent_subsidy_enabled) === 1,
    rentSubsidyPrice: nullableNumber(row.rent_subsidy_price),
    mgmtFeeEnabled: numberValue(row.mgmt_fee_enabled) === 1,
    mgmtFeePrice: nullableNumber(row.mgmt_fee_price),
    assignmentLevel: row.assignment_level === 'worker' ? 'worker' : 'crew',
    note: stringValue(row.note),
    status: stringValue(row.status),
  }
}

function rowToMember(row: Record<string, unknown>): CrewDetailMember {
  return {
    id: stringValue(row.id),
    name: stringValue(row.name),
    trade: stringValue(row.trade),
    phone: stringValue(row.phone),
    projectStatus: stringValue(row.project_status),
    currentProjectId: nullableString(row.current_project_id),
    currentProjectName: stringValue(row.current_project_name),
    entryDate: stringValue(row.entry_date),
    dailyWage: nullableNumber(row.daily_wage),
    linkedWorkerId: nullableString(row.linked_worker_id),
    linkedWorkerName: stringValue(row.linked_worker_name),
  }
}

function rowToPenalty(row: Record<string, unknown>): CrewPenaltyRecord {
  const source = stringValue(row.source)
  const status = stringValue(row.status)
  return {
    id: stringValue(row.id),
    no: stringValue(row.no),
    projectId: nullableString(row.projectId),
    projectName: stringValue(row.project_name),
    source,
    sourceLabel: PENALTY_SOURCE_LABEL[source] ?? (source || '—'),
    location: stringValue(row.location),
    reason: stringValue(row.reason),
    amount: numberValue(row.amount),
    penaltyDate: stringValue(row.penaltyDate),
    status,
    statusLabel: PENALTY_STATUS_LABEL[status] ?? (status || '—'),
  }
}

function mergeProjectAssociations(
  members: readonly CrewDetailMember[],
  assignments: readonly AssignmentProjectRow[],
  wages: readonly WageProjectRow[],
): CrewProjectAssociation[] {
  const projects = new Map<string, CrewProjectAssociation & { sourceSet: Set<CrewProjectSource> }>()

  function ensureProject(input: {
    projectId: string
    projectName: string
    projectCode?: string
    projectStatus?: string
  }) {
    const existing = projects.get(input.projectId)
    if (existing) {
      if (!existing.projectName)
        existing.projectName = input.projectName
      if (!existing.projectCode)
        existing.projectCode = input.projectCode ?? ''
      if (!existing.projectStatus)
        existing.projectStatus = input.projectStatus ?? ''
      return existing
    }
    const created: CrewProjectAssociation & { sourceSet: Set<CrewProjectSource> } = {
      projectId: input.projectId,
      projectName: input.projectName,
      projectCode: input.projectCode ?? '',
      projectStatus: input.projectStatus ?? '',
      sources: [],
      sourceSet: new Set(),
      activeMemberCount: 0,
      assignmentCount: 0,
      assignedUnitCount: 0,
      completedStageCount: 0,
      wageStatementCount: 0,
      wageGrossAmount: 0,
      releasedWageAmount: 0,
    }
    projects.set(input.projectId, created)
    return created
  }

  for (const member of members) {
    if (!member.currentProjectId || member.projectStatus !== '在场')
      continue
    const project = ensureProject({
      projectId: member.currentProjectId,
      projectName: member.currentProjectName,
    })
    project.sourceSet.add('在场成员')
    project.activeMemberCount += 1
  }

  for (const row of assignments) {
    const project = ensureProject({
      projectId: row.project_id,
      projectName: row.project_name,
      projectCode: row.project_code,
      projectStatus: row.project_status,
    })
    project.sourceSet.add('工程量责任')
    project.assignmentCount = numberValue(row.assignment_count)
    project.assignedUnitCount = numberValue(row.assigned_unit_count)
    project.completedStageCount = numberValue(row.completed_stage_count)
  }

  for (const row of wages) {
    const project = ensureProject({
      projectId: row.project_id,
      projectName: row.project_name,
      projectCode: row.project_code,
      projectStatus: row.project_status,
    })
    project.sourceSet.add('工资单')
    project.wageStatementCount = numberValue(row.statement_count)
    project.wageGrossAmount = numberValue(row.gross_amount)
    project.releasedWageAmount = numberValue(row.released_amount)
  }

  return [...projects.values()].map(({ sourceSet, ...project }) => ({
    ...project,
    sources: PROJECT_SOURCE_ORDER.filter(source => sourceSet.has(source)),
  }))
}

export const useCrewDetailStore = defineStore('crew-detail', () => {
  const snapshots = shallowRef<Record<string, CrewDetailSnapshot | null>>({})
  const loadingIds = shallowRef(new Set<string>())
  const inFlightLoads = new Map<string, Promise<CrewDetailSnapshot | null>>()

  function byCrew(crewId: string): CrewDetailSnapshot | null {
    return snapshots.value[crewId] ?? null
  }

  function hasSnapshot(crewId: string): boolean {
    return Object.hasOwn(snapshots.value, crewId)
  }

  function isLoading(crewId: string): boolean {
    return loadingIds.value.has(crewId)
  }

  function setLoading(crewId: string, loading: boolean) {
    const next = new Set(loadingIds.value)
    if (loading)
      next.add(crewId)
    else
      next.delete(crewId)
    loadingIds.value = next
  }

  async function loadSnapshot(crewId: string): Promise<CrewDetailSnapshot | null> {
    const [crewRow] = await select<Record<string, unknown>>(
      selectVisibleSql('crews', 'AND id = ? LIMIT 1'),
      [crewId],
    )
    if (!crewRow) {
      snapshots.value = { ...snapshots.value, [crewId]: null }
      return null
    }

    const [memberRows, assignmentRows, wageRows, penaltyRows] = await Promise.all([
      select<Record<string, unknown>>(
        `${hiddenCtesFor('workers', 'projects')}
         SELECT
           worker.*,
           project.name AS current_project_name,
           linked_worker.name AS linked_worker_name
         FROM workers AS worker
         LEFT JOIN projects AS project
           ON project.id = worker.current_project_id
          AND ${visibleCond('projects', 'project')}
         LEFT JOIN workers AS linked_worker
           ON linked_worker.id = worker.linked_worker_id
          AND linked_worker.deleted_at IS NULL
         WHERE ${visibleCond('workers', 'worker')}
           AND worker.crew_id = ?
         ORDER BY
           CASE worker.project_status WHEN '在场' THEN 0 ELSE 1 END,
           worker.name`,
        [crewId],
      ),
      select<AssignmentProjectRow>(
        `${hiddenCtesFor('unit_assignments', 'unit_stage_completions')}
         SELECT
           project.id AS project_id,
           project.name AS project_name,
           project.code AS project_code,
           project.status AS project_status,
           COUNT(DISTINCT assignment.id) AS assignment_count,
           COUNT(DISTINCT assignment.unit_id) AS assigned_unit_count,
           COUNT(DISTINCT CASE
             WHEN completion.status = 'completed' THEN completion.id
           END) AS completed_stage_count
         FROM unit_assignments AS assignment
         JOIN units AS unit ON unit.id = assignment.unit_id
         JOIN floors AS floor ON floor.id = unit.floor_id
         JOIN buildings AS building ON building.id = floor.building_id
         JOIN projects AS project ON project.id = building.project_id
         LEFT JOIN unit_stage_completions AS completion
           ON completion.assignment_id = assignment.id
          AND ${visibleCond('unit_stage_completions', 'completion')}
         WHERE ${visibleCond('unit_assignments', 'assignment')}
           AND assignment.crew_id = ?
         GROUP BY project.id, project.name, project.code, project.status
         ORDER BY project.name`,
        [crewId],
      ),
      select<WageProjectRow>(
        `${hiddenCtes('wage_statements')}
         SELECT
           project.id AS project_id,
           project.name AS project_name,
           project.code AS project_code,
           project.status AS project_status,
           COUNT(statement.id) AS statement_count,
           COALESCE(SUM(statement.gross_amount), 0) AS gross_amount,
           COALESCE(SUM(
             CASE
               WHEN statement.status = 'released'
                 THEN COALESCE(statement.actual_amount, 0)
               ELSE 0
             END
           ), 0) AS released_amount
         FROM wage_statements AS statement
         JOIN projects AS project ON project.id = statement.project_id
         WHERE ${visibleCond('wage_statements', 'statement')}
           AND statement.crew_id = ?
         GROUP BY project.id, project.name, project.code, project.status
         ORDER BY project.name`,
        [crewId],
      ),
      select<Record<string, unknown>>(
        `${hiddenCtes('penalty_records')}
         SELECT penalty.*, project.name AS project_name
         FROM penalty_records AS penalty
         LEFT JOIN projects AS project ON project.id = penalty.projectId
         WHERE ${visibleCond('penalty_records', 'penalty')}
           AND penalty.crewId = ?
         ORDER BY penalty.penaltyDate DESC, penalty.createdAt DESC`,
        [crewId],
      ),
    ])

    const crew = rowToCrew(crewRow)
    const members = memberRows.map(rowToMember)
    const projects = mergeProjectAssociations(members, assignmentRows, wageRows)
    const penalties = penaltyRows.map(rowToPenalty)
    const summary: CrewDetailSummary = {
      memberCount: members.length,
      activeMemberCount: members.filter(member => member.projectStatus === '在场').length,
      projectCount: projects.length,
      assignedUnitCount: projects.reduce((sum, project) => sum + project.assignedUnitCount, 0),
      completedStageCount: projects.reduce((sum, project) => sum + project.completedStageCount, 0),
      wageStatementCount: projects.reduce((sum, project) => sum + project.wageStatementCount, 0),
      releasedWageAmount: projects.reduce((sum, project) => sum + project.releasedWageAmount, 0),
      penaltyAmount: penalties.reduce((sum, penalty) => sum + penalty.amount, 0),
    }
    const snapshot: CrewDetailSnapshot = {
      crew,
      members,
      projects,
      penalties,
      summary,
    }
    snapshots.value = { ...snapshots.value, [crewId]: snapshot }
    return snapshot
  }

  async function load(crewId: string): Promise<CrewDetailSnapshot | null> {
    const inFlight = inFlightLoads.get(crewId)
    if (inFlight)
      return inFlight

    const task = (async () => {
      setLoading(crewId, true)
      try {
        return await loadSnapshot(crewId)
      }
      finally {
        setLoading(crewId, false)
      }
    })()
    inFlightLoads.set(crewId, task)

    try {
      return await task
    }
    finally {
      if (inFlightLoads.get(crewId) === task)
        inFlightLoads.delete(crewId)
    }
  }

  return {
    byCrew,
    hasSnapshot,
    isLoading,
    load,
  }
})
