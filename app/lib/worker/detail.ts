import type { MigrationDb } from '~/lib/db/migrations'
import type { MasterDataCapabilities } from '~/lib/master-data/capabilities'
import { hiddenCtesFor, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'
import { effectiveMasterDataCapabilities } from '~/lib/master-data/capabilities'

export type WorkerProjectSource = '当前项目' | '工程量责任' | '考勤' | '签工' | '工资单' | '扣罚'

export interface WorkerMaster {
  id: string
  name: string
  gender: string
  idCard: string
  phone: string
  hometown: string
  emergencyContact: string
  emergencyPhone: string
  trade: string
  skillLevel: string
  dailyWage: number | null
  projectStatus: string
  entryDate: string
  exitDate: string
  safetyEducation: boolean
  note: string
  bankName: string
  bankAccount: string
  bankCode: string
  status: string
}

export interface WorkerCrew {
  id: string
  name: string
  trade: string
  contactName: string
  contactPhone: string
}

export interface WorkerRelatedPerson {
  id: string
  name: string
  phone: string
  trade: string
  status: string
  source: 'family' | 'legacy'
}

export interface WorkerAttachment {
  id: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
}

export interface WorkerProject {
  id: string
  name: string
  code: string
  status: string
  sources: WorkerProjectSource[]
}

export interface WorkerAssignmentScope {
  roomName: string
  itemName: string
}

export interface WorkerAssignment {
  id: string
  projectId: string
  projectName: string
  projectCode: string
  buildingName: string
  floorName: string
  unitId: string
  unitName: string
  trade: string
  note: string
  completedStageCount: number
  scopes: WorkerAssignmentScope[]
}

export interface WorkerAttendance {
  id: string
  projectId: string
  projectName: string
  workDate: string
  hours: number
  overtimeHours: number
  workContent: string
  note: string
}

export interface WorkerDaywork {
  id: string
  projectId: string
  projectName: string
  workDate: string
  workContent: string
  startTime: string
  endTime: string
  laborUnits: number
  witness: string
  confirmedOn: string
  status: string
  note: string
}

export interface WorkerWageLine {
  id: string
  itemName: string
  unit: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface WorkerWageStatement {
  id: string
  projectId: string
  projectName: string
  month: string
  formatFamily: string
  periodKind: string
  quantitySource: string
  status: string
  payRatio: number
  statementGrossAmount: number
  statementActualAmount: number | null
  workerLineAmount: number
  allocatedAmount: number | null
  allocationRecorded: boolean
  isLeader: boolean
  lines: WorkerWageLine[]
}

export interface WorkerPenalty {
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

export interface WorkerDetailSummary {
  projectCount: number
  assignedUnitCount: number
  completedStageCount: number
  attendanceDays: number
  attendanceHours: number
  overtimeHours: number
  confirmedDayworkUnits: number
  releasedStatementCount: number
  knownAllocatedAmount: number
  missingAllocationCount: number
  penaltyAmount: number
}

export interface WorkerDetail {
  worker: WorkerMaster
  crew: WorkerCrew | null
  capabilities: MasterDataCapabilities
  relatedWorkers: WorkerRelatedPerson[]
  attachments: WorkerAttachment[]
  projects: WorkerProject[]
  assignments: WorkerAssignment[]
  attendance: WorkerAttendance[]
  daywork: WorkerDaywork[]
  wageStatements: WorkerWageStatement[]
  penalties: WorkerPenalty[]
  summary: WorkerDetailSummary
}

interface WorkerRow extends Record<string, unknown> {
  id: string
  crew_id: string | null
  crew_name: string | null
  crew_trade: string | null
  crew_contact_name: string | null
  crew_contact_phone: string | null
  current_project_id: string | null
  current_project_name: string | null
  current_project_code: string | null
  current_project_status: string | null
  family_group_id: string | null
  linked_worker_id: string | null
}

function text(value: unknown): string {
  return value == null ? '' : String(value)
}

function number(value: unknown): number {
  return Number(value) || 0
}

function nullableNumber(value: unknown): number | null {
  return value == null || value === '' ? null : number(value)
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

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

const WORKER_RECORD_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  approved: '已审核',
  rejected: '已退回',
  active: '在用',
  inactive: '停用',
}

export function workerRecordStatusLabel(status: string): string {
  return WORKER_RECORD_STATUS_LABEL[status] ?? (status || '未定')
}

export function workerPresenceStatusLabel(status: string): string {
  return status || '未登记'
}

function addProjectSource(
  projects: Map<string, WorkerProject>,
  input: { id: string, name: string, code: string, status: string },
  source: WorkerProjectSource,
) {
  if (!input.id)
    return
  const existing = projects.get(input.id)
  if (existing) {
    if (!existing.sources.includes(source))
      existing.sources.push(source)
    return
  }
  projects.set(input.id, { ...input, sources: [source] })
}

async function loadWorkerRow(db: MigrationDb, workerId: string): Promise<WorkerRow | null> {
  const rows = await db.select<WorkerRow>(
    `${hiddenCtesFor('workers', 'projects')}
     SELECT
       w.*,
       c.name AS crew_name,
       c.trade AS crew_trade,
       c.contact_name AS crew_contact_name,
       c.contact_phone AS crew_contact_phone,
       p.name AS current_project_name,
       p.code AS current_project_code,
       p.status AS current_project_status
     FROM workers w
     LEFT JOIN crews c ON c.id = w.crew_id
     LEFT JOIN projects p
       ON p.id = w.current_project_id
      AND ${visibleCond('projects', 'p')}
     WHERE ${visibleCond('workers', 'w')} AND w.id = ?`,
    [workerId],
  )
  return rows[0] ?? null
}

async function loadRelatedWorkers(db: MigrationDb, worker: WorkerRow): Promise<WorkerRelatedPerson[]> {
  if (!worker.family_group_id && !worker.linked_worker_id) {
    const reverse = await db.select<{ present: number }>(
      `${hiddenCtesFor('workers')}
       SELECT 1 AS present FROM workers w
       WHERE ${visibleCond('workers', 'w')} AND w.linked_worker_id = ?
       LIMIT 1`,
      [worker.id],
    )
    if (!reverse.length)
      return []
  }
  const rows = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('workers')}
     SELECT w.id, w.name, w.phone, w.trade, w.status, w.family_group_id, w.linked_worker_id
     FROM workers w
     WHERE ${visibleCond('workers', 'w')}
       AND w.id <> ?
       AND (
         (? <> '' AND w.family_group_id = ?)
         OR w.id = ?
         OR w.linked_worker_id = ?
       )
     ORDER BY w.name, w.id`,
    [
      worker.id,
      text(worker.family_group_id),
      text(worker.family_group_id),
      text(worker.linked_worker_id),
      worker.id,
    ],
  )
  return rows.map(row => ({
    id: text(row.id),
    name: text(row.name),
    phone: text(row.phone),
    trade: text(row.trade),
    status: text(row.status),
    source: worker.family_group_id && row.family_group_id === worker.family_group_id
      ? 'family'
      : 'legacy',
  }))
}

async function loadAttachments(db: MigrationDb, workerId: string): Promise<WorkerAttachment[]> {
  const rows = await db.select<Record<string, unknown>>(
    `${selectVisibleSql('file_refs', 'AND owner_type = ? AND owner_id = ? ORDER BY uploaded_at DESC, id')}`,
    ['worker', workerId],
  )
  return rows.map(row => ({
    id: text(row.id),
    fileName: text(row.file_name),
    filePath: text(row.file_path),
    fileSize: number(row.file_size),
    mimeType: text(row.mime_type),
    category: text(row.category),
    uploader: text(row.uploader),
    uploadedAt: text(row.uploaded_at),
  }))
}

async function loadAssignments(db: MigrationDb, workerId: string): Promise<WorkerAssignment[]> {
  const rows = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('unit_assignments', 'unit_stage_completions')}
     SELECT
       ua.id, ua.trade, ua.note,
       u.id AS unit_id, COALESCE(NULLIF(u.name, ''), u.code) AS unit_name,
       f.name AS floor_name, b.name AS building_name,
       p.id AS project_id, p.name AS project_name, p.code AS project_code,
       COUNT(DISTINCT CASE WHEN usc.status = 'completed' THEN usc.id END) AS completed_stage_count
     FROM unit_assignments ua
     JOIN units u ON u.id = ua.unit_id
     JOIN floors f ON f.id = u.floor_id
     JOIN buildings b ON b.id = f.building_id
     JOIN projects p ON p.id = b.project_id
     LEFT JOIN unit_stage_completions usc
       ON usc.assignment_id = ua.id AND ${visibleCond('unit_stage_completions', 'usc')}
     WHERE ${visibleCond('unit_assignments', 'ua')} AND ua.worker_id = ?
     GROUP BY ua.id, ua.trade, ua.note, u.id, u.name, u.code, f.name, b.name,
              p.id, p.name, p.code
     ORDER BY p.name, b.sort_order, f.sort_order, u.sort_order, ua.created_at`,
    [workerId],
  )
  if (!rows.length)
    return []

  const scopes = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('unit_assignment_scopes')}
     SELECT uas.assignment_id, r.name AS room_name, i.name AS item_name
     FROM unit_assignment_scopes uas
     JOIN unit_assignments ua ON ua.id = uas.assignment_id
     JOIN rooms r ON r.id = uas.room_id
     JOIN items i ON i.id = uas.item_id
     WHERE ${visibleCond('unit_assignment_scopes', 'uas')} AND ua.worker_id = ?
     ORDER BY uas.created_at, uas.id`,
    [workerId],
  )
  const scopesByAssignment = new Map<string, WorkerAssignmentScope[]>()
  for (const row of scopes) {
    const assignmentId = text(row.assignment_id)
    const list = scopesByAssignment.get(assignmentId) ?? []
    list.push({ roomName: text(row.room_name), itemName: text(row.item_name) })
    scopesByAssignment.set(assignmentId, list)
  }

  return rows.map(row => ({
    id: text(row.id),
    projectId: text(row.project_id),
    projectName: text(row.project_name),
    projectCode: text(row.project_code),
    buildingName: text(row.building_name),
    floorName: text(row.floor_name),
    unitId: text(row.unit_id),
    unitName: text(row.unit_name),
    trade: text(row.trade),
    note: text(row.note),
    completedStageCount: number(row.completed_stage_count),
    scopes: scopesByAssignment.get(text(row.id)) ?? [],
  }))
}

async function loadAttendance(db: MigrationDb, workerId: string): Promise<WorkerAttendance[]> {
  const rows = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('attendance_records')}
     SELECT a.*, p.name AS project_name
     FROM attendance_records a
     JOIN projects p ON p.id = a.project_id
     WHERE ${visibleCond('attendance_records', 'a')} AND a.worker_id = ?
     ORDER BY a.work_date DESC, a.id DESC`,
    [workerId],
  )
  return rows.map(row => ({
    id: text(row.id),
    projectId: text(row.project_id),
    projectName: text(row.project_name),
    workDate: text(row.work_date),
    hours: number(row.hours),
    overtimeHours: number(row.overtime_hours),
    workContent: text(row.work_content),
    note: text(row.note),
  }))
}

async function loadDaywork(db: MigrationDb, workerId: string): Promise<WorkerDaywork[]> {
  const rows = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('signed_daywork_records')}
     SELECT d.*, p.name AS project_name
     FROM signed_daywork_records d
     JOIN projects p ON p.id = d.project_id
     WHERE ${visibleCond('signed_daywork_records', 'd')} AND d.worker_id = ?
     ORDER BY d.work_date DESC, d.id DESC`,
    [workerId],
  )
  return rows.map(row => ({
    id: text(row.id),
    projectId: text(row.project_id),
    projectName: text(row.project_name),
    workDate: text(row.work_date),
    workContent: text(row.work_content),
    startTime: text(row.start_time),
    endTime: text(row.end_time),
    laborUnits: number(row.labor_units),
    witness: text(row.witness),
    confirmedOn: text(row.confirmed_on),
    status: text(row.status),
    note: text(row.note),
  }))
}

async function loadWageStatements(db: MigrationDb, workerId: string): Promise<WorkerWageStatement[]> {
  const rows = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('wage_statements', 'wage_statement_members', 'wage_statement_lines')}
     SELECT
       ws.*, p.name AS project_name,
       CASE WHEN ws.leader_worker_id = ? THEN 1 ELSE 0 END AS is_leader
     FROM wage_statements ws
     JOIN projects p ON p.id = ws.project_id
     WHERE ${visibleCond('wage_statements', 'ws')}
       AND (
         ws.leader_worker_id = ?
         OR EXISTS (
           SELECT 1 FROM wage_statement_members wsm
           WHERE ${visibleCond('wage_statement_members', 'wsm')}
             AND wsm.statement_id = ws.id AND wsm.worker_id = ?
         )
         OR EXISTS (
           SELECT 1 FROM wage_statement_lines wsl
           WHERE ${visibleCond('wage_statement_lines', 'wsl')}
             AND wsl.statement_id = ws.id AND wsl.worker_id = ?
         )
       )
     ORDER BY ws.month DESC, ws.created_at DESC, ws.id DESC`,
    [workerId, workerId, workerId, workerId],
  )
  if (!rows.length)
    return []

  const statementIds = rows.map(row => text(row.id))
  const placeholders = statementIds.map(() => '?').join(', ')
  const lines = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('wage_statement_lines')}
     SELECT *
     FROM wage_statement_lines wsl
     WHERE ${visibleCond('wage_statement_lines', 'wsl')}
       AND wsl.worker_id = ?
       AND wsl.statement_id IN (${placeholders})
     ORDER BY wsl.statement_id, wsl.sort_order, wsl.id`,
    [workerId, ...statementIds],
  )
  const allocations = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('wage_statement_allocations')}
     SELECT statement_id, allocated_amount_fen
     FROM wage_statement_allocations wsa
     WHERE ${visibleCond('wage_statement_allocations', 'wsa')}
       AND wsa.worker_id = ?
       AND wsa.statement_id IN (${placeholders})`,
    [workerId, ...statementIds],
  )

  const linesByStatement = new Map<string, WorkerWageLine[]>()
  for (const row of lines) {
    const statementId = text(row.statement_id)
    const list = linesByStatement.get(statementId) ?? []
    list.push({
      id: text(row.id),
      itemName: text(row.item_name),
      unit: text(row.unit),
      quantity: number(row.quantity),
      unitPrice: number(row.unit_price),
      amount: number(row.amount),
    })
    linesByStatement.set(statementId, list)
  }
  const allocationByStatement = new Map(
    allocations.map(row => [text(row.statement_id), number(row.allocated_amount_fen) / 100]),
  )

  return rows.map((row) => {
    const id = text(row.id)
    const workerLines = linesByStatement.get(id) ?? []
    const allocationRecorded = allocationByStatement.has(id)
    return {
      id,
      projectId: text(row.project_id),
      projectName: text(row.project_name),
      month: text(row.month),
      formatFamily: text(row.format_family),
      periodKind: text(row.period_kind),
      quantitySource: text(row.quantity_source),
      status: text(row.status),
      payRatio: number(row.pay_ratio),
      statementGrossAmount: number(row.gross_amount),
      statementActualAmount: nullableNumber(row.actual_amount),
      workerLineAmount: round(workerLines.reduce((sum, line) => sum + line.amount, 0)),
      allocatedAmount: allocationRecorded ? allocationByStatement.get(id)! : null,
      allocationRecorded,
      isLeader: number(row.is_leader) === 1,
      lines: workerLines,
    }
  })
}

async function loadPenalties(db: MigrationDb, workerId: string): Promise<WorkerPenalty[]> {
  const rows = await db.select<Record<string, unknown>>(
    `${hiddenCtesFor('penalty_records')}
     SELECT penalty.*, project.name AS project_name
     FROM penalty_records penalty
     LEFT JOIN projects project ON project.id = penalty.projectId
     WHERE ${visibleCond('penalty_records', 'penalty')}
       AND (penalty.workerId = ? OR penalty.responsibleWorkerId = ?)
     ORDER BY penalty.penaltyDate DESC, penalty.createdAt DESC, penalty.id DESC`,
    [workerId, workerId],
  )
  return rows.map((row) => {
    const source = text(row.source)
    const status = text(row.status)
    return {
      id: text(row.id),
      no: text(row.no),
      projectId: text(row.projectId) || null,
      projectName: text(row.project_name),
      source,
      sourceLabel: PENALTY_SOURCE_LABEL[source] ?? (source || '—'),
      location: text(row.location) || [text(row.building), text(row.floor), text(row.room)].filter(Boolean).join(' / '),
      reason: text(row.reason),
      amount: number(row.amount),
      penaltyDate: text(row.penaltyDate),
      status,
      statusLabel: PENALTY_STATUS_LABEL[status] ?? (status || '—'),
    }
  })
}

export async function loadWorkerDetail(db: MigrationDb, workerId: string): Promise<WorkerDetail | null> {
  const row = await loadWorkerRow(db, workerId)
  if (!row)
    return null

  const [relatedWorkers, attachments, assignments, attendance, daywork, wageStatements, penalties] = await Promise.all([
    loadRelatedWorkers(db, row),
    loadAttachments(db, workerId),
    loadAssignments(db, workerId),
    loadAttendance(db, workerId),
    loadDaywork(db, workerId),
    loadWageStatements(db, workerId),
    loadPenalties(db, workerId),
  ])

  const projects = new Map<string, WorkerProject>()
  if (row.current_project_id && row.current_project_name) {
    addProjectSource(projects, {
      id: row.current_project_id,
      name: text(row.current_project_name),
      code: text(row.current_project_code),
      status: text(row.current_project_status),
    }, '当前项目')
  }
  for (const assignment of assignments) {
    addProjectSource(projects, {
      id: assignment.projectId,
      name: assignment.projectName,
      code: assignment.projectCode,
      status: '',
    }, '工程量责任')
  }
  for (const record of attendance) {
    addProjectSource(projects, {
      id: record.projectId,
      name: record.projectName,
      code: '',
      status: '',
    }, '考勤')
  }
  for (const record of daywork) {
    addProjectSource(projects, {
      id: record.projectId,
      name: record.projectName,
      code: '',
      status: '',
    }, '签工')
  }
  for (const statement of wageStatements) {
    addProjectSource(projects, {
      id: statement.projectId,
      name: statement.projectName,
      code: '',
      status: '',
    }, '工资单')
  }
  for (const penalty of penalties) {
    if (!penalty.projectId)
      continue
    addProjectSource(projects, {
      id: penalty.projectId,
      name: penalty.projectName,
      code: '',
      status: '',
    }, '扣罚')
  }

  const releasedStatements = wageStatements.filter(statement => statement.status === 'released')
  return {
    worker: {
      id: row.id,
      name: text(row.name),
      gender: text(row.gender),
      idCard: text(row.id_card),
      phone: text(row.phone),
      hometown: text(row.hometown),
      emergencyContact: text(row.emergency_contact),
      emergencyPhone: text(row.emergency_phone),
      trade: text(row.trade),
      skillLevel: text(row.skill_level),
      dailyWage: nullableNumber(row.daily_wage),
      projectStatus: text(row.project_status),
      entryDate: text(row.entry_date),
      exitDate: text(row.exit_date),
      safetyEducation: number(row.safety_education) === 1,
      note: text(row.note),
      bankName: text(row.bank_name),
      bankAccount: text(row.bank_account),
      bankCode: text(row.bank_code),
      status: text(row.status),
    },
    crew: row.crew_id
      ? {
          id: row.crew_id,
          name: text(row.crew_name),
          trade: text(row.crew_trade),
          contactName: text(row.crew_contact_name),
          contactPhone: text(row.crew_contact_phone),
        }
      : null,
    capabilities: effectiveMasterDataCapabilities(
      row.trade,
      row.trade_capabilities,
      row.item_capabilities,
    ),
    relatedWorkers,
    attachments,
    projects: [...projects.values()],
    assignments,
    attendance,
    daywork,
    wageStatements,
    penalties,
    summary: {
      projectCount: projects.size,
      assignedUnitCount: new Set(assignments.map(assignment => assignment.unitId)).size,
      completedStageCount: assignments.reduce((sum, assignment) => sum + assignment.completedStageCount, 0),
      attendanceDays: new Set(attendance.map(record => record.workDate)).size,
      attendanceHours: round(attendance.reduce((sum, record) => sum + record.hours, 0)),
      overtimeHours: round(attendance.reduce((sum, record) => sum + record.overtimeHours, 0)),
      confirmedDayworkUnits: round(daywork
        .filter(record => record.status === 'confirmed')
        .reduce((sum, record) => sum + record.laborUnits, 0)),
      releasedStatementCount: releasedStatements.length,
      knownAllocatedAmount: round(releasedStatements
        .reduce((sum, statement) => sum + (statement.allocatedAmount ?? 0), 0)),
      missingAllocationCount: releasedStatements
        .filter(statement => !statement.allocationRecorded)
        .length,
      penaltyAmount: round(penalties.reduce((sum, penalty) => sum + penalty.amount, 0)),
    },
  }
}
