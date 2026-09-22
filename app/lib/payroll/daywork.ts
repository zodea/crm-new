import type { PayrollDb } from './statements'
import { generateId } from '~/lib/util/id'

export type SignedDayworkStatus = 'draft' | 'confirmed'

export interface SignedDayworkInput {
  id?: string
  projectId: string
  crewId?: string | null
  workerId: string
  workDate: string
  workContent: string
  startTime: string
  endTime: string
  laborUnits: 0.5 | 1
  witness?: string
  confirmedOn?: string | null
  status: SignedDayworkStatus
  note?: string
}

export interface SignedDayworkRecord {
  id: string
  projectId: string
  projectName: string
  crewId: string | null
  crewName: string
  workerId: string
  workerName: string
  workDate: string
  workContent: string
  startTime: string
  endTime: string
  laborUnits: number
  witness: string
  confirmedOn: string | null
  status: SignedDayworkStatus
  note: string
  updatedAt: string
}

export interface SignedDayworkFilter {
  projectId: string
  month: string
  crewId?: string
  status?: SignedDayworkStatus | '' | SignedDayworkStatus[]
}

export interface C2SubjectConfigInput {
  projectId: string
  crewId?: string | null
  leaderWorkerId: string
  unitRate: number
  ruleText: string
}

export interface C2SubjectConfig {
  id: string
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  unitRate: number
  ruleText: string
  updatedAt: string
}

interface DayworkRow {
  id: string
  project_id: string
  project_name: string
  crew_id: string | null
  crew_name: string | null
  worker_id: string
  worker_name: string
  work_date: string
  work_content: string
  start_time: string
  end_time: string
  labor_units: number
  witness: string
  confirmed_on: string | null
  status: SignedDayworkStatus
  note: string
  updated_at: string
}

const DAYWORK_SELECT = `
  SELECT record.id, record.project_id, project.name AS project_name,
         record.crew_id, crew.name AS crew_name,
         record.worker_id, worker.name AS worker_name,
         record.work_date, record.work_content, record.start_time, record.end_time,
         record.labor_units, record.witness, record.confirmed_on,
         record.status, record.note, record.updated_at
  FROM signed_daywork_records record
  JOIN projects project ON project.id = record.project_id
  JOIN workers worker ON worker.id = record.worker_id
  LEFT JOIN crews crew ON crew.id = record.crew_id
`

function mapDaywork(row: DayworkRow): SignedDayworkRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    crewId: row.crew_id,
    crewName: row.crew_name ?? '',
    workerId: row.worker_id,
    workerName: row.worker_name,
    workDate: row.work_date,
    workContent: row.work_content,
    startTime: row.start_time,
    endTime: row.end_time,
    laborUnits: Number(row.labor_units),
    witness: row.witness,
    confirmedOn: row.confirmed_on,
    status: row.status,
    note: row.note,
    updatedAt: row.updated_at,
  }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

async function validateParticipant(
  db: PayrollDb,
  input: Pick<SignedDayworkInput, 'projectId' | 'crewId' | 'workerId'>,
): Promise<string | null> {
  const [row] = await db.select<{
    crew_id: string | null
    current_project_id: string | null
    has_project_responsibility: number
  }>(`
    SELECT worker.crew_id, worker.current_project_id,
           CASE WHEN EXISTS (
             SELECT 1
             FROM unit_assignments assignment
             JOIN units unit ON unit.id = assignment.unit_id AND unit.deleted_at IS NULL
             JOIN floors floor ON floor.id = unit.floor_id AND floor.deleted_at IS NULL
             JOIN buildings building ON building.id = floor.building_id AND building.deleted_at IS NULL
             WHERE assignment.deleted_at IS NULL
               AND building.project_id = ?
               AND (
                 assignment.worker_id = worker.id
                 OR (worker.crew_id IS NOT NULL AND assignment.crew_id = worker.crew_id)
               )
           ) THEN 1 ELSE 0 END AS has_project_responsibility
    FROM workers worker
    WHERE worker.id = ? AND worker.deleted_at IS NULL
  `, [input.projectId, input.workerId])
  if (!row)
    throw new Error('签工人员不存在或已停用')
  const [project] = await db.select<{ id: string }>(`
    SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL
  `, [input.projectId])
  if (!project)
    throw new Error('项目不存在或已停用')
  if (
    row.current_project_id !== input.projectId
    && !row.has_project_responsibility
  ) {
    throw new Error('签工人员不属于当前项目')
  }
  const requestedCrewId = input.crewId?.trim() || null
  if (requestedCrewId && requestedCrewId !== row.crew_id)
    throw new Error('所选班组与签工人员档案归属不一致')
  return row.crew_id
}

export async function upsertC2SubjectConfig(
  db: PayrollDb,
  input: C2SubjectConfigInput,
): Promise<string> {
  if (!Number.isFinite(input.unitRate) || input.unitRate <= 0)
    throw new Error('C2 大工单价必须大于 0')
  await validateParticipant(db, {
    projectId: input.projectId,
    crewId: input.crewId,
    workerId: input.leaderWorkerId,
  })
  const [current] = await db.select<{ id: string }>(`
    SELECT id
    FROM payroll_subject_configs
    WHERE project_id = ?
      AND leader_worker_id = ?
      AND format_family = 'C2'
      AND deleted_at IS NULL
  `, [input.projectId, input.leaderWorkerId])
  const id = current?.id ?? generateId('payroll_subject_config')
  if (current) {
    await db.execute(`
      UPDATE payroll_subject_configs
      SET crew_id = ?, unit_rate = ?, rule_text = ?, enabled = 1,
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      input.crewId?.trim() || null,
      input.unitRate,
      input.ruleText.trim(),
      id,
    ])
  }
  else {
    await db.execute(`
      INSERT INTO payroll_subject_configs (
        id, project_id, crew_id, leader_worker_id, format_family,
        unit_rate, rule_text
      ) VALUES (?, ?, ?, ?, 'C2', ?, ?)
    `, [
      id,
      input.projectId,
      input.crewId?.trim() || null,
      input.leaderWorkerId,
      input.unitRate,
      input.ruleText.trim(),
    ])
  }
  return id
}

export async function listC2SubjectConfigs(
  db: PayrollDb,
  projectId = '',
): Promise<C2SubjectConfig[]> {
  const rows = await db.select<{
    id: string
    project_id: string
    crew_id: string | null
    leader_worker_id: string
    unit_rate: number
    rule_text: string
    updated_at: string
  }>(`
    SELECT id, project_id, crew_id, leader_worker_id, unit_rate, rule_text, updated_at
    FROM payroll_subject_configs
    WHERE format_family = 'C2'
      AND enabled = 1
      AND deleted_at IS NULL
      AND (? = '' OR project_id = ?)
    ORDER BY updated_at DESC, id
  `, [projectId, projectId])
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    crewId: row.crew_id,
    leaderWorkerId: row.leader_worker_id,
    unitRate: Number(row.unit_rate),
    ruleText: row.rule_text,
    updatedAt: row.updated_at,
  }))
}

export async function saveSignedDayworkRecord(
  db: PayrollDb,
  input: SignedDayworkInput,
): Promise<string> {
  if (!isValidDate(input.workDate))
    throw new Error('签工日期必须是有效日期（YYYY-MM-DD）')
  if (!isValidTime(input.startTime) || !isValidTime(input.endTime))
    throw new Error('起止时间必须使用 HH:mm 格式')
  if (input.startTime >= input.endTime)
    throw new Error('结束时间必须晚于开始时间')
  if (input.laborUnits !== 0.5 && input.laborUnits !== 1)
    throw new Error('用工数只允许整工 1 或半工 0.5')
  const workContent = input.workContent.trim()
  if (!workContent)
    throw new Error('必须填写施工内容')
  const witness = input.witness?.trim() ?? ''
  const confirmedOn = input.confirmedOn?.trim() || null
  if (input.status === 'confirmed') {
    if (!witness || !confirmedOn)
      throw new Error('已确认签工必须填写证明人和确认日期')
    if (!isValidDate(confirmedOn))
      throw new Error('确认日期必须是有效日期（YYYY-MM-DD）')
    if (confirmedOn < input.workDate)
      throw new Error('确认日期不能早于签工日期')
  }

  if (input.id) {
    const [current] = await db.select<{ id: string }>(`
      SELECT id
      FROM signed_daywork_records
      WHERE id = ? AND deleted_at IS NULL
    `, [input.id])
    if (!current)
      throw new Error('签工记录不存在或已删除')
    const [releasedLink] = await db.select<{ id: string }>(`
      SELECT statement.id
      FROM wage_statement_daywork_records link
      JOIN wage_statements statement
        ON statement.id = link.statement_id
       AND statement.deleted_at IS NULL
      WHERE link.daywork_record_id = ?
        AND link.deleted_at IS NULL
        AND statement.status = 'released'
      LIMIT 1
    `, [input.id])
    if (releasedLink)
      throw new Error('该签工记录已发放，不能移动或修改')
  }

  const crewId = await validateParticipant(db, input)
  const [attendance] = await db.select<{ id: string }>(`
    SELECT id
    FROM attendance_records
    WHERE project_id = ?
      AND worker_id = ?
      AND substr(work_date, 1, 7) = substr(?, 1, 7)
      AND deleted_at IS NULL
    LIMIT 1
  `, [input.projectId, input.workerId, input.workDate])
  if (attendance)
    throw new Error('该人员当月已有考勤记录，不能同时使用 C2 零星签工')
  const [released] = await db.select<{ id: string }>(`
    SELECT statement.id
    FROM wage_statements statement
    LEFT JOIN wage_statement_members member
      ON member.statement_id = statement.id
     AND member.worker_id = ?
     AND member.deleted_at IS NULL
    WHERE statement.project_id = ?
      AND statement.month = substr(?, 1, 7)
      AND statement.format_family = 'C2'
      AND statement.status = 'released'
      AND statement.deleted_at IS NULL
      AND (statement.leader_worker_id = ? OR member.worker_id IS NOT NULL)
    LIMIT 1
  `, [input.workerId, input.projectId, input.workDate, input.workerId])
  if (released)
    throw new Error('该月 C2 工资已发放，签工记录已冻结；补签需走后续调整流程')

  const sameDayRecords = await db.select<{
    id: string
    start_time: string
    end_time: string
    labor_units: number
  }>(`
    SELECT id, start_time, end_time, labor_units
    FROM signed_daywork_records
    WHERE project_id = ?
      AND worker_id = ?
      AND work_date = ?
      AND deleted_at IS NULL
      AND (? IS NULL OR id <> ?)
  `, [
    input.projectId,
    input.workerId,
    input.workDate,
    input.id ?? null,
    input.id ?? null,
  ])
  if (sameDayRecords.some(record =>
    record.start_time < input.endTime && record.end_time > input.startTime,
  )) {
    throw new Error('同一人员同日签工时段重叠，请调整起止时间')
  }
  const dayLaborUnits = sameDayRecords.reduce<number>(
    (sum, record) => sum + Number(record.labor_units),
    input.laborUnits,
  )
  if (dayLaborUnits > 1)
    throw new Error('同一人员同日用工数不能超过 1 工')

  const id = input.id ?? generateId('signed_daywork')
  if (input.id) {
    await db.execute(`
      UPDATE signed_daywork_records
      SET project_id = ?, crew_id = ?, worker_id = ?, work_date = ?,
          work_content = ?, start_time = ?, end_time = ?, labor_units = ?,
          witness = ?, confirmed_on = ?, status = ?, note = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      input.projectId,
      crewId,
      input.workerId,
      input.workDate,
      workContent,
      input.startTime,
      input.endTime,
      input.laborUnits,
      witness,
      confirmedOn,
      input.status,
      input.note?.trim() ?? '',
      id,
    ])
  }
  else {
    await db.execute(`
      INSERT INTO signed_daywork_records (
        id, project_id, crew_id, worker_id, work_date, work_content,
        start_time, end_time, labor_units, witness, confirmed_on, status, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      input.projectId,
      crewId,
      input.workerId,
      input.workDate,
      workContent,
      input.startTime,
      input.endTime,
      input.laborUnits,
      witness,
      confirmedOn,
      input.status,
      input.note?.trim() ?? '',
    ])
  }
  return id
}

export async function listSignedDayworkRecords(
  db: PayrollDb,
  filter: SignedDayworkFilter,
): Promise<SignedDayworkRecord[]> {
  if (!filter.projectId || !filter.month)
    return []
  const clauses = [
    'record.project_id = ?',
    'substr(record.work_date, 1, 7) = ?',
    'record.deleted_at IS NULL',
  ]
  const params: unknown[] = [filter.projectId, filter.month]
  if (filter.crewId) {
    clauses.push('record.crew_id = ?')
    params.push(filter.crewId)
  }
  const statuses = Array.isArray(filter.status) ? [...new Set(filter.status)] : filter.status ? [filter.status] : []
  if (statuses.length) {
    clauses.push(`record.status IN (${statuses.map(() => '?').join(', ')})`)
    params.push(...statuses)
  }
  const rows = await db.select<DayworkRow>(`
    ${DAYWORK_SELECT}
    WHERE ${clauses.join(' AND ')}
    ORDER BY record.work_date DESC, record.start_time, worker.name, record.id
  `, params)
  return rows.map(mapDaywork)
}

export async function listStatementDayworkRecords(
  db: PayrollDb,
  statementId: string,
): Promise<SignedDayworkRecord[]> {
  const rows = await db.select<DayworkRow>(`
    ${DAYWORK_SELECT}
    JOIN wage_statement_daywork_records link
      ON link.daywork_record_id = record.id
     AND link.deleted_at IS NULL
    WHERE link.statement_id = ?
      AND record.deleted_at IS NULL
    ORDER BY record.work_date, record.start_time, worker.name, record.id
  `, [statementId])
  return rows.map(mapDaywork)
}
