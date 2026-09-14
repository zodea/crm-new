import type { TransactionDb } from '../../app/lib/db/coordinator'
import { createHash } from 'node:crypto'
import { payrollLogSnapshot } from '../../app/lib/migration/payroll-source'
import { decodePayrollAttendanceResult, encodePayrollAttendanceWire, parsePayrollAttendanceCommand, payrollAttendanceCanonical } from '../../app/lib/payroll/central-attendance-codec'
import { decodePayrollC1Result, encodePayrollC1Wire, isPayrollC1StatementSourceSnapshot, parsePayrollC1Command } from '../../app/lib/payroll/central-c1-codec'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

export const PAYROLL_C1_REFERENCE_TABLES = ['payroll_c1_rate_revisions', 'payroll_c1_statement_sources'] as const
const actions = new Set(['save-c1-draft', 'check-c1', 'release-c1', 'save-c1-rates', 'upsert-attendance'])
function invalid(): never {
  throw new ProjectRepositoryProblem(projectProblem('conflict', '工资迁移：C1/考勤原证据无法确认，不能安全撤回来源'))
}
function parse(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  }
  catch { /* 统一保留恢复失败，不吞掉坏正文。 */ }
  return invalid()
}
function collector() {
  const refs = new Set<string>()
  function add(table: string, id: unknown) {
    if (id === null || id === undefined)
      return
    if (typeof id !== 'string' || !id)
      invalid()
    refs.add(JSON.stringify([table, id]))
  }
  function subject(value: { projectId?: unknown, crewId?: unknown, workerId?: unknown, leaderWorkerId?: unknown }) {
    add('projects', value.projectId)
    add('crews', value.crewId)
    add('workers', value.workerId)
    add('workers', value.leaderWorkerId)
  }
  return { refs, add, subject }
}

/** null 表示交回 A 的原封闭解析器；已知 C1 动作绝不以解析失败为由跳过。 */
export function payrollC1ReceiptReferences(value: Record<string, unknown>): Set<string> | null {
  if (!actions.has(String(value.action)))
    return null
  const { refs, add, subject } = collector()
  if (value.command_json === null || value.command_json === undefined)
    return refs
  const data = parse(value.command_json)
  if (payrollAttendanceCanonical(data) !== value.command_json || createHash('sha256').update(String(value.command_json)).digest('hex') !== value.fingerprint)
    invalid()
  try {
    const command = value.action === 'upsert-attendance' ? parsePayrollAttendanceCommand(encodePayrollAttendanceWire(data)) : parsePayrollC1Command(encodePayrollC1Wire(data))
    for (const [field, expected] of [['command_id', command.commandId], ['actor_id', command.actorId], ['project_id', command.projectId], ['action', command.action.kind]] as const) {
      if (value[field] !== expected)
        invalid()
    }
    add('projects', command.projectId)
    if ('scope' in command) {
      if (value.statement_id !== null || value.config_scope_json !== null)
        invalid()
      subject(command.scope)
      subject(command.action.record)
      const result = decodePayrollAttendanceResult(parse(value.result_json), command)
      add('attendance_records', result.recordId)
    }
    else {
      if (value.config_scope_json === null ? command.configScope !== null : payrollAttendanceCanonical(parse(value.config_scope_json)) !== payrollAttendanceCanonical(command.configScope))
        invalid()
      const result = decodePayrollC1Result(parse(value.result_json), command)
      if (value.statement_id !== result.statementId)
        invalid()
      add('wage_statements', result.statementId)
      for (const id of result.rateRevisionIds) add('payroll_c1_rate_revisions', id)
      if (command.configScope)
        subject(command.configScope)
      const action = command.action
      if (action.kind === 'save-c1-draft') {
        subject(action.draft)
        for (const id of action.draft.memberWorkerIds) add('workers', id)
      }
      else if (action.kind === 'release-c1') {
        for (const row of action.release.allocations) add('workers', row.workerId)
      }
      else if (action.kind === 'save-c1-rates') {
        for (const row of action.rates) add('workers', row.workerId)
      }
    }
  }
  catch { return invalid() }
  return refs
}

/** 只按封闭 source 与已知 SQL 列收集稳定关系，不扫描历史快照里的任意 ID。 */
export async function payrollC1MigrationReferences(tx: TransactionDb): Promise<Set<string>> {
  const { refs, add, subject } = collector()
  function source(value: unknown) {
    if (!isPayrollC1StatementSourceSnapshot(value))
      invalid()
    subject(value.subject)
    for (const id of value.subject.memberWorkerIds) add('workers', id)
    for (const fact of value.facts) {
      subject(fact)
      add('attendance_records', fact.id)
    }
    for (const rate of value.rates) {
      add('workers', rate.workerId)
      add('payroll_c1_rate_revisions', rate.configId)
    }
  }
  function row(table: string, value: Record<string, unknown>) {
    subject({ projectId: value.project_id, workerId: value.worker_id, leaderWorkerId: value.leader_worker_id })
    add('wage_statements', value.statement_id)
    if (table === 'payroll_c1_statement_sources')
      source(parse(value.source_json))
    if (table === 'wage_statements') {
      const snapshot = payrollLogSnapshot(value.snapshot_json)
      if (snapshot && Object.hasOwn(snapshot, 'c1Source'))
        source(snapshot.c1Source)
    }
  }
  for (const table of PAYROLL_C1_REFERENCE_TABLES) {
    for (const value of await tx.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) row(table, value)
  }
  for (const value of await tx.select<Record<string, unknown>>('SELECT snapshot_json FROM wage_statements WHERE format_family=\'C1\'')) row('wage_statements', value)
  const logTables = [...PAYROLL_C1_REFERENCE_TABLES, 'wage_statements']
  const logs = await tx.select<{ table_name: string, record_id: string, before_data: string | null, after_data: string | null }>(`SELECT table_name,record_id,before_data,after_data FROM operation_logs WHERE table_name IN (${logTables.map(() => '?').join(',')})`, logTables)
  for (const log of logs) {
    if (log.table_name !== 'wage_statements')
      add(log.table_name, log.record_id)
    for (const value of [log.before_data, log.after_data]) {
      if (value !== null) {
        if (log.table_name === 'wage_statements') {
          const snapshot = payrollLogSnapshot(payrollLogSnapshot(value)?.snapshot_json)
          if (snapshot && Object.hasOwn(snapshot, 'c1Source'))
            source(snapshot.c1Source)
        }
        else {
          row(log.table_name, parse(value))
        }
      }
    }
  }
  return refs
}
