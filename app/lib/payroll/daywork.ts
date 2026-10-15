import type { PayrollDb } from './statements'

export type SignedDayworkStatus = 'draft' | 'confirmed'

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
