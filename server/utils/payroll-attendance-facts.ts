import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollAttendanceDiagnostic, PayrollAttendanceFact, PayrollAttendanceFacts } from '../../app/lib/payroll/central-attendance-contract'
import type { PayrollIdentityMapping, PayrollSourceEvidence } from '../../app/lib/payroll/central-contract'
import { createHash } from 'node:crypto'
import { parsePayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { isISODateDTO } from '../../app/types/read-model'

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function hours(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24 ? value : null
}
function mappings(value: unknown): PayrollIdentityMapping[] {
  if (!Array.isArray(value) || !value.every(row => row !== null && typeof row === 'object' && typeof row.tableName === 'string' && typeof row.legacyId === 'string' && (row.centralId === null || typeof row.centralId === 'string')))
    throw payrollProblem('validation-failed', '原考勤身份映射无法确认')
  return value
}

/** 在调用者持有的同库事务内逐日读原事实；当前名册不重写原考勤班组。 */
export async function loadPayrollAttendanceFacts(tx: TransactionDb, query: { projectId: string, month: string }): Promise<PayrollAttendanceFacts> {
  if (!query.projectId || !isISODateDTO(`${query.month}-01`))
    throw payrollProblem('validation-failed', '考勤项目与月份无效')
  const raw = await tx.select<PayrollMigrationRow>('SELECT * FROM attendance_records WHERE project_id=? ORDER BY id', [query.projectId])
  const subjects = Object.fromEntries(await Promise.all(['projects', 'workers', 'crews'].map(async table => [table, await tx.select<{ id: string, deleted_at: string | null }>(`SELECT id,deleted_at FROM ${table} ORDER BY id`)]))) as Record<string, Array<{ id: string, deleted_at: string | null }>>
  const rows: PayrollAttendanceFact[] = []
  const diagnostics: PayrollAttendanceDiagnostic[] = []
  const evidence: PayrollSourceEvidence[] = []
  const relevantRaw: PayrollMigrationRow[] = []
  function diagnose(row: PayrollMigrationRow, code: string, message: string, field: string | null = null) {
    diagnostics.push({ code, message, recordId: text(row.id), workerId: text(row.worker_id), field, tableName: 'attendance_records', entityId: null, legacyRecordId: null })
  }
  for (const row of raw) {
    const date = text(row.work_date) ?? ''
    if (isISODateDTO(date) && date.slice(0, 7) !== query.month)
      continue
    relevantRaw.push(row)
    if (!isISODateDTO(date))
      diagnose(row, 'attendance-date-invalid', '原考勤日期无法确认，不能据此证明工资月份完整', 'work_date')
    const normal = hours(row.hours)
    const overtime = hours(row.overtime_hours)
    if (normal === null || overtime === null || normal + overtime > 24)
      diagnose(row, 'attendance-hours-invalid', '原正常或加班工时缺失、非法或合计超过 24 小时', normal === null ? 'hours' : 'overtime_hours')
    for (const [field, table] of [['project_id', 'projects'], ['worker_id', 'workers'], ['crew_id', 'crews']] as const) {
      if (field === 'crew_id' && row[field] === null)
        continue
      const parent = subjects[table]!.find(parent => parent.id === row[field])
      if (!parent || parent.deleted_at !== null)
        diagnose(row, 'attendance-subject-unavailable', '原考勤关联档案已缺失或隐藏；原身份保留，不能按当前名册补接', field)
    }
    rows.push({ id: String(row.id), projectId: query.projectId, crewId: text(row.crew_id), workerId: String(row.worker_id), workDate: date, hours: normal, overtimeHours: overtime, workContent: text(row.work_content), note: text(row.note), deletedAt: text(row.deleted_at), createdAt: text(row.created_at), updatedAt: text(row.updated_at), sourceFingerprint: hash(row) })
  }
  for (const row of rows.filter(row => row.deletedAt === null)) {
    if (rows.some(other => other.id !== row.id && other.deletedAt === null && other.workerId === row.workerId && other.workDate === row.workDate))
      diagnostics.push({ code: 'attendance-duplicate', message: '同一人员同日存在多条原考勤，不能重复计薪', recordId: row.id, workerId: row.workerId, field: 'work_date', tableName: 'attendance_records', entityId: null, legacyRecordId: null })
  }
  const saved = await tx.select<{ entity_id: string, source_graph_json: string, mapping_json: string }>('SELECT entity_id,source_graph_json,mapping_json FROM payroll_migration_evidence WHERE project_id=? ORDER BY entity_id', [query.projectId])
  for (const entry of saved) {
    const source = parsePayrollProjectGraph(JSON.parse(entry.source_graph_json))
    const map = mappings(JSON.parse(entry.mapping_json))
    const relevant = source.attendance.filter(row => !isISODateDTO(row.work_date) || row.work_date.slice(0, 7) === query.month)
    if (!relevant.length)
      continue
    evidence.push({ entityId: entry.entity_id, source: { ...source }, mappings: map })
    for (const row of relevant) {
      if (map.some(mapping => mapping.tableName === 'attendance_records' && mapping.legacyId === row.id && mapping.centralId !== null))
        continue
      const workerId = map.find(mapping => mapping.tableName === 'workers' && mapping.legacyId === row.worker_id)?.centralId ?? null
      diagnostics.push({ code: 'attendance-isolated', message: '原考勤的身份、关系或字段不能确认为可用来源；完整原行保留在迁入证据中', recordId: null, workerId, field: null, tableName: 'attendance_records', entityId: entry.entity_id, legacyRecordId: text(row.id) })
    }
  }
  return { sourceVersion: `payroll-attendance:${hash([query, relevantRaw, diagnostics, evidence])}`, rows, diagnostics, evidence }
}
