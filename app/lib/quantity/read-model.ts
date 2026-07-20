import type { SoftDb } from '~/lib/db/soft-delete'
import { hiddenCtes, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'

export interface QuantityCatalogProject {
  id: string
  code: string
  name: string
  hasQuantityData: boolean
}

export interface QuantityBuilding {
  id: string
  projectId: string
  code: string
  name: string
  sortOrder: number
}

export interface QuantityFloor {
  id: string
  buildingId: string
  code: string
  name: string
  sortOrder: number
}

export interface QuantityUnit {
  id: string
  floorId: string
  templateId: string
  code: string
  name: string
  sortOrder: number
}

export interface QuantityStage {
  id: string
  projectId: string
  code: string
  name: string
  trade: string
  sortOrder: number
}

export type QuantityAssigneeKind = 'crew' | 'worker'

export interface QuantityAssignment {
  id: string
  unitId: string
  trade: string
  assigneeKind: QuantityAssigneeKind
  assigneeId: string
  assigneeName: string
  note: string
}

export type QuantityCompletionStatus = 'draft' | 'completed'

export interface QuantityCompletion {
  id: string
  unitId: string
  stageId: string
  stageName: string
  stageTrade: string
  stageSortOrder: number
  assignmentId: string | null
  assigneeKind: QuantityAssigneeKind | null
  assigneeId: string | null
  assigneeName: string
  status: QuantityCompletionStatus
  completedAt: string | null
  note: string
}

export interface QuantityProjectSnapshot {
  projectId: string
  buildings: readonly QuantityBuilding[]
  floors: readonly QuantityFloor[]
  units: readonly QuantityUnit[]
  stages: readonly QuantityStage[]
  assignments: readonly QuantityAssignment[]
  completions: readonly QuantityCompletion[]
}

interface ProjectRow {
  id: string
  code: string | null
  name: string | null
}

interface BuildingRow {
  id: string
  project_id: string
  code: string
  name: string
  sort_order: number
}

interface FloorRow {
  id: string
  building_id: string
  code: string
  name: string
  sort_order: number
}

interface UnitRow {
  id: string
  floor_id: string
  house_type_template_id: string
  code: string
  name: string | null
  sort_order: number
}

interface StageRow {
  id: string
  project_id: string
  code: string
  name: string
  trade: string
  sort_order: number
}

interface AssignmentRow {
  id: string
  unit_id: string
  trade: string
  crew_id: string | null
  worker_id: string | null
  crew_name: string | null
  worker_name: string | null
  note: string | null
}

interface CompletionRow {
  id: string
  unit_id: string
  stage_id: string
  stage_name: string
  stage_trade: string
  stage_sort_order: number
  assignment_id: string | null
  crew_id: string | null
  worker_id: string | null
  crew_name: string | null
  worker_name: string | null
  status: QuantityCompletionStatus
  completed_at: string | null
  note: string | null
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapBuilding(row: BuildingRow): QuantityBuilding {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    sortOrder: numberValue(row.sort_order),
  }
}

function mapFloor(row: FloorRow): QuantityFloor {
  return {
    id: row.id,
    buildingId: row.building_id,
    code: row.code,
    name: row.name,
    sortOrder: numberValue(row.sort_order),
  }
}

function mapUnit(row: UnitRow): QuantityUnit {
  return {
    id: row.id,
    floorId: row.floor_id,
    templateId: row.house_type_template_id,
    code: row.code,
    name: row.name || `${row.code}户`,
    sortOrder: numberValue(row.sort_order),
  }
}

function mapStage(row: StageRow): QuantityStage {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    name: row.name,
    trade: row.trade,
    sortOrder: numberValue(row.sort_order),
  }
}

function assigneeFromRow(row: Pick<AssignmentRow, 'crew_id' | 'worker_id' | 'crew_name' | 'worker_name'>): {
  kind: QuantityAssigneeKind
  id: string
  name: string
} | null {
  if (row.crew_id) {
    return {
      kind: 'crew',
      id: row.crew_id,
      name: row.crew_name || '已删除班组',
    }
  }
  if (row.worker_id) {
    return {
      kind: 'worker',
      id: row.worker_id,
      name: row.worker_name || '已删除工人',
    }
  }
  return null
}

function mapAssignment(row: AssignmentRow): QuantityAssignment | null {
  const assignee = assigneeFromRow(row)
  if (!assignee)
    return null
  return {
    id: row.id,
    unitId: row.unit_id,
    trade: row.trade,
    assigneeKind: assignee.kind,
    assigneeId: assignee.id,
    assigneeName: assignee.name,
    note: row.note ?? '',
  }
}

function mapCompletion(row: CompletionRow): QuantityCompletion {
  const assignee = assigneeFromRow(row)
  return {
    id: row.id,
    unitId: row.unit_id,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageTrade: row.stage_trade,
    stageSortOrder: numberValue(row.stage_sort_order),
    assignmentId: row.assignment_id,
    assigneeKind: assignee?.kind ?? null,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.name ?? '未记录执行责任',
    status: row.status,
    completedAt: row.completed_at,
    note: row.note ?? '',
  }
}

export async function loadQuantityCatalog(db: SoftDb): Promise<QuantityCatalogProject[]> {
  const projects = await db.select<ProjectRow>(
    selectVisibleSql('projects', 'ORDER BY code, name, id'),
  )
  const buildings = await db.select<BuildingRow>(
    selectVisibleSql('buildings'),
  )
  const projectIdsWithBuildings = new Set(buildings.map(row => row.project_id))
  return projects.map(row => ({
    id: row.id,
    code: row.code ?? '',
    name: row.name || '未命名项目',
    hasQuantityData: projectIdsWithBuildings.has(row.id),
  }))
}

export async function loadQuantityProjectSnapshot(db: SoftDb, projectId: string): Promise<QuantityProjectSnapshot> {
  const buildings = await db.select<BuildingRow>(
    selectVisibleSql('buildings', 'AND project_id = ? ORDER BY sort_order, code, id'),
    [projectId],
  )

  const floors = await db.select<FloorRow>(
    `${hiddenCtes('floors')}
     SELECT f.*
     FROM floors f
     JOIN buildings b ON b.id = f.building_id
     WHERE ${visibleCond('floors', 'f')} AND b.project_id = ?
     ORDER BY b.sort_order, f.sort_order, f.code, f.id`,
    [projectId],
  )

  const units = await db.select<UnitRow>(
    `${hiddenCtes('units')}
     SELECT u.*
     FROM units u
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     WHERE ${visibleCond('units', 'u')}
       AND b.project_id = ?
       AND ht.project_id = ?
     ORDER BY b.sort_order, f.sort_order, u.sort_order, u.code, u.id`,
    [projectId, projectId],
  )

  const stages = await db.select<StageRow>(
    selectVisibleSql('construction_stages', 'AND project_id = ? ORDER BY sort_order, code, id'),
    [projectId],
  )

  const assignments = await db.select<AssignmentRow>(
    `${hiddenCtes('unit_assignments')}
     SELECT ua.*, c.name AS crew_name, w.name AS worker_name
     FROM unit_assignments ua
     JOIN units u ON u.id = ua.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     LEFT JOIN crews c ON c.id = ua.crew_id
     LEFT JOIN workers w ON w.id = ua.worker_id
     WHERE ${visibleCond('unit_assignments', 'ua')}
       AND b.project_id = ?
       AND ht.project_id = ?
     ORDER BY ua.trade, ua.created_at, ua.id`,
    [projectId, projectId],
  )

  // completion.assignment_id 是完成时责任的审计引用，不是可见性祖先；这里故意物理
  // JOIN 已软删 assignment/crew/worker，让责任替换后历史时间线仍保留当时身份。
  const completions = await db.select<CompletionRow>(
    `${hiddenCtes('unit_stage_completions')}
     SELECT usc.id,
            usc.unit_id,
            usc.stage_id,
            s.name AS stage_name,
            s.trade AS stage_trade,
            s.sort_order AS stage_sort_order,
            usc.assignment_id,
            audit.crew_id,
            audit.worker_id,
            c.name AS crew_name,
            w.name AS worker_name,
            usc.status,
            usc.completed_at,
            usc.note
     FROM unit_stage_completions usc
     JOIN units u ON u.id = usc.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN house_type_templates ht ON ht.id = u.house_type_template_id
     JOIN construction_stages s ON s.id = usc.stage_id
     LEFT JOIN unit_assignments audit
       ON audit.id = usc.assignment_id
      AND audit.unit_id = usc.unit_id
      AND audit.trade = s.trade
     LEFT JOIN crews c ON c.id = audit.crew_id
     LEFT JOIN workers w ON w.id = audit.worker_id
     WHERE ${visibleCond('unit_stage_completions', 'usc')}
       AND b.project_id = ?
       AND ht.project_id = ?
       AND s.project_id = ?
     ORDER BY usc.completed_at DESC, s.sort_order DESC, usc.id`,
    [projectId, projectId, projectId],
  )

  return {
    projectId,
    buildings: buildings.map(mapBuilding),
    floors: floors.map(mapFloor),
    units: units.map(mapUnit),
    stages: stages.map(mapStage),
    assignments: assignments.map(mapAssignment).filter((row): row is QuantityAssignment => row !== null),
    completions: completions.map(mapCompletion),
  }
}
