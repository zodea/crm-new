import type { PayrollDb } from './statements'
import { generateId } from '~/lib/util/id'

export interface AttendanceInput {
  projectId: string
  crewId?: string | null
  workerId: string
  workDate: string
  hours: number
  overtimeHours?: number
  workContent?: string
  note?: string
}

export interface AttendanceRecord {
  id: string
  projectId: string
  crewId: string | null
  workerId: string
  workerName: string
  workDate: string
  hours: number
  overtimeHours: number
  workContent: string
  note: string
}

export interface AttendanceFilter {
  projectId: string
  month: string
  crewId?: string
}

export async function listAttendanceBlockedWorkerIds(
  db: PayrollDb,
  filter: Pick<AttendanceFilter, 'projectId' | 'month'>,
): Promise<string[]> {
  if (!filter.projectId || !filter.month)
    return []
  const rows = await db.select<{ worker_id: string }>(`
    SELECT ws.leader_worker_id AS worker_id
    FROM wage_statements ws
    WHERE ws.project_id = ?
      AND ws.month = ?
      AND (
        ws.format_family = 'C2'
        OR (ws.format_family = 'C1' AND ws.status = 'released')
      )
      AND ws.deleted_at IS NULL
    UNION
    SELECT member.worker_id
    FROM wage_statements ws
    JOIN wage_statement_members member
      ON member.statement_id = ws.id
      AND member.deleted_at IS NULL
    WHERE ws.project_id = ?
      AND ws.month = ?
      AND (
        ws.format_family = 'C2'
        OR (ws.format_family = 'C1' AND ws.status = 'released')
      )
      AND ws.deleted_at IS NULL
  `, [filter.projectId, filter.month, filter.projectId, filter.month])
  return rows.map(row => row.worker_id)
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export async function upsertAttendanceRecord(db: PayrollDb, input: AttendanceInput): Promise<string> {
  if (!isValidDate(input.workDate))
    throw new Error('考勤日期必须是有效日期（YYYY-MM-DD）')
  const overtime = input.overtimeHours ?? 0
  if (!Number.isFinite(input.hours) || input.hours < 0 || input.hours > 24)
    throw new Error('正常工时应在 0 到 24 小时之间')
  if (!Number.isFinite(overtime) || overtime < 0 || overtime > 24)
    throw new Error('加班工时应在 0 到 24 小时之间')
  if (input.hours + overtime > 24)
    throw new Error('正常工时与加班工时合计不能超过 24 小时')

  const [worker] = await db.select<{
    crew_id: string | null
    current_project_id: string | null
    crew_is_active: number
    has_project_responsibility: number
  }>(`
    SELECT w.crew_id,
           w.current_project_id,
           CASE
             WHEN w.crew_id IS NULL THEN 1
             WHEN crew.id IS NOT NULL THEN 1
             ELSE 0
           END AS crew_is_active,
           CASE WHEN EXISTS (
             SELECT 1
             FROM unit_assignments ua
             JOIN units u ON u.id = ua.unit_id AND u.deleted_at IS NULL
             JOIN floors f ON f.id = u.floor_id AND f.deleted_at IS NULL
             JOIN buildings b ON b.id = f.building_id AND b.deleted_at IS NULL
             WHERE ua.deleted_at IS NULL
               AND b.project_id = ?
               AND (ua.worker_id = w.id OR (w.crew_id IS NOT NULL AND ua.crew_id = w.crew_id))
           ) THEN 1 ELSE 0 END AS has_project_responsibility
    FROM workers w
    LEFT JOIN crews crew
      ON crew.id = w.crew_id
      AND crew.deleted_at IS NULL
    WHERE w.id = ? AND w.deleted_at IS NULL
  `, [input.projectId, input.workerId])
  if (!worker)
    throw new Error('工人不存在')

  const [project] = await db.select<{ id: string }>(`
    SELECT id
    FROM projects
    WHERE id = ? AND deleted_at IS NULL
  `, [input.projectId])
  if (!project)
    throw new Error('项目不存在')

  if (
    worker.current_project_id !== input.projectId
    && !worker.has_project_responsibility
  ) {
    throw new Error('该工人不属于当前项目')
  }
  if (!worker.crew_is_active)
    throw new Error('该工人的档案班组不存在或已停用')

  const requestedCrewId = input.crewId?.trim() || null
  if (requestedCrewId && requestedCrewId !== worker.crew_id)
    throw new Error('所选班组与工人档案归属不一致')

  // 班组归属只能从工人档案取得。调用方传入 crewId 仅用于校验当前
  // 班组视图没有串组；全班组视图不传 crewId 时仍自动继承档案归属。
  const crewId = worker.crew_id

  const [lockedBook] = await db.select<{
    id: string
    format_family: 'C1' | 'C2'
    status: string
  }>(`
    SELECT ws.id, ws.format_family, ws.status
    FROM wage_statements ws
    LEFT JOIN wage_statement_members member
      ON member.statement_id = ws.id
      AND member.worker_id = ?
      AND member.deleted_at IS NULL
    WHERE ws.project_id = ?
      AND ws.month = substr(?, 1, 7)
      AND (
        ws.format_family = 'C2'
        OR (ws.format_family = 'C1' AND ws.status = 'released')
      )
      AND ws.deleted_at IS NULL
      AND (ws.leader_worker_id = ? OR member.worker_id IS NOT NULL)
    LIMIT 1
  `, [input.workerId, input.projectId, input.workDate, input.workerId])
  if (lockedBook?.format_family === 'C2')
    throw new Error('C2 零星签工以逐日签工记录作为出勤依据，不生成考勤表')
  if (lockedBook?.format_family === 'C1')
    throw new Error('该月 C1 工资已发放，考勤已锁定；后补工时需走后续调整流程')

  const [signedDaywork] = await db.select<{ id: string }>(`
    SELECT id
    FROM signed_daywork_records
    WHERE project_id = ?
      AND worker_id = ?
      AND substr(work_date, 1, 7) = substr(?, 1, 7)
      AND deleted_at IS NULL
    LIMIT 1
  `, [input.projectId, input.workerId, input.workDate])
  if (signedDaywork)
    throw new Error('该人员当月已有 C2 签工记录，不能再录入考勤')

  const [current] = await db.select<{ id: string }>(`
    SELECT id FROM attendance_records
    WHERE project_id = ? AND worker_id = ? AND work_date = ? AND deleted_at IS NULL
  `, [input.projectId, input.workerId, input.workDate])
  const id = current?.id ?? generateId('attendance')
  if (current) {
    await db.execute(`
      UPDATE attendance_records
      SET crew_id = ?, hours = ?, overtime_hours = ?, work_content = ?, note = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `, [
      crewId,
      input.hours,
      overtime,
      input.workContent?.trim() ?? '',
      input.note?.trim() ?? '',
      id,
    ])
  }
  else {
    await db.execute(`
      INSERT INTO attendance_records (
        id, project_id, crew_id, worker_id, work_date, hours,
        overtime_hours, work_content, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      input.projectId,
      crewId,
      input.workerId,
      input.workDate,
      input.hours,
      overtime,
      input.workContent?.trim() ?? '',
      input.note?.trim() ?? '',
    ])
  }
  return id
}

export async function listAttendanceRecords(
  db: PayrollDb,
  filter: AttendanceFilter,
): Promise<AttendanceRecord[]> {
  const clauses = [
    'ar.project_id = ?',
    'substr(ar.work_date, 1, 7) = ?',
    'ar.deleted_at IS NULL',
  ]
  const params: unknown[] = [filter.projectId, filter.month]
  if (filter.crewId) {
    clauses.push('ar.crew_id = ?')
    params.push(filter.crewId)
  }
  const rows = await db.select<{
    id: string
    project_id: string
    crew_id: string | null
    worker_id: string
    worker_name: string
    work_date: string
    hours: number
    overtime_hours: number
    work_content: string
    note: string
  }>(`
    SELECT ar.id, ar.project_id, ar.crew_id, ar.worker_id, w.name AS worker_name,
           ar.work_date, ar.hours, ar.overtime_hours, ar.work_content, ar.note
    FROM attendance_records ar
    JOIN workers w ON w.id = ar.worker_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY w.name, ar.work_date
  `, params)
  return rows.map(row => ({
    id: row.id,
    projectId: row.project_id,
    crewId: row.crew_id,
    workerId: row.worker_id,
    workerName: row.worker_name,
    workDate: row.work_date,
    hours: Number(row.hours),
    overtimeHours: Number(row.overtime_hours),
    workContent: row.work_content,
    note: row.note,
  }))
}
