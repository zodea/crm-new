import type { TransactionDb } from '../../app/lib/db/coordinator'
import { createHash } from 'node:crypto'
import { payrollLogSnapshot } from '../../app/lib/migration/payroll-source'
import { decodePayrollC2Result, encodePayrollC2Wire, isPayrollC2FrozenDocument, isPayrollC2StatementSourceSnapshot, parsePayrollC2Command } from '../../app/lib/payroll/central-c2-codec'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { decodePayrollDayworkResult, encodePayrollDayworkWire, parsePayrollDayworkCommand } from '../../app/lib/payroll/central-daywork-codec'
import { payrollObject } from '../../app/lib/payroll/central-snapshot'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

export const PAYROLL_C2_REFERENCE_TABLES = ['payroll_c2_statement_sources'] as const

function invalid(): never {
  throw new ProjectRepositoryProblem(projectProblem('conflict', '工资迁移：C2/签工原证据无法确认，不能安全撤回来源'))
}
function parse(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  }
  catch { /* 不吞掉非空坏正文，统一拒绝危险恢复。 */ }
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

/** 已知动作必须闭合原命令/结果；null 只把其它格式交回原分派器。 */
export function payrollC2ReceiptReferences(value: Record<string, unknown>): Set<string> | null {
  const daywork = value.action === 'save-daywork' || value.action === 'confirm-daywork'
  if (!daywork && !['save-c2-config', 'save-c2-draft', 'check-c2', 'release-c2'].includes(String(value.action)))
    return null
  const { refs, add, subject } = collector()
  if (value.command_json === null || value.command_json === undefined)
    return refs
  const data = parse(value.command_json)
  if (payrollCanonical(data) !== value.command_json || createHash('sha256').update(String(value.command_json)).digest('hex') !== value.fingerprint)
    invalid()
  function metadata(command: { commandId: string, actorId: string, projectId: string, action: { kind: string } }) {
    for (const [field, expected] of [['command_id', command.commandId], ['actor_id', command.actorId], ['project_id', command.projectId], ['action', command.action.kind]] as const) {
      if (value[field] !== expected)
        invalid()
    }
  }
  try {
    if (!daywork) {
      const command = parsePayrollC2Command(encodePayrollC2Wire(data))
      metadata(command)
      if (value.config_scope_json === null ? command.configScope !== null : payrollCanonical(parse(value.config_scope_json)) !== payrollCanonical(command.configScope))
        invalid()
      const result = decodePayrollC2Result(parse(value.result_json), command)
      if (value.statement_id !== result.statementId)
        invalid()
      subject(command)
      add('wage_statements', result.statementId)
      add('payroll_subject_configs', command.configId)
      add('payroll_subject_configs', result.configId)
      for (const id of result.dayworkRecordIds) add('signed_daywork_records', id)
      for (const id of result.dayworkLinkIds) add('wage_statement_daywork_records', id)
      if (command.configScope)
        subject(command.configScope)
      const action = command.action
      if (action.kind === 'save-c2-config') {
        subject(action.config)
      }
      else if (action.kind === 'save-c2-draft') {
        subject(action.draft)
        for (const id of action.draft.memberWorkerIds) add('workers', id)
      }
      else if (action.kind === 'release-c2') {
        for (const allocation of action.release.allocations) add('workers', allocation.workerId)
      }
      return refs
    }
    const command = parsePayrollDayworkCommand(encodePayrollDayworkWire(data))
    metadata(command)
    if (value.statement_id !== null || value.config_scope_json !== null)
      invalid()
    subject(command)
    add('signed_daywork_records', command.recordId)
    if (command.originalScope)
      subject(command.originalScope)
    if (command.action.kind === 'save-daywork')
      subject(command.action.record)
    const result = decodePayrollDayworkResult(parse(value.result_json), command)
    add('signed_daywork_records', result.recordId)
    add('projects', result.recordProjectId)
    add('workers', result.workerId)
    for (const id of result.affectedStatementIds) add('wage_statements', id)
  }
  catch { return invalid() }
  return refs
}

/** 只收集封闭 C2 采用源/冻结文档及其审计中的稳定引用，original 原文不递归猜 ID。 */
export async function payrollC2MigrationReferences(tx: TransactionDb): Promise<Set<string>> {
  const { refs, add, subject } = collector()
  function source(value: unknown) {
    if (!isPayrollC2StatementSourceSnapshot(value))
      invalid()
    subject(value.subject)
    for (const id of value.subject.memberWorkerIds) add('workers', id)
    subject(value.config)
    add('payroll_subject_configs', value.config.id)
    for (const member of value.members) subject(member)
    for (const fact of value.facts) {
      subject(fact)
      add('signed_daywork_records', fact.id)
    }
  }
  function snapshot(value: unknown) {
    const saved = payrollLogSnapshot(value)
    if (saved && Object.hasOwn(saved, 'c2Source'))
      source(saved.c2Source)
    if (saved && Object.hasOwn(saved, 'c2Document')) {
      const document = saved.c2Document
      if (!isPayrollC2FrozenDocument(document))
        invalid()
      subject(document)
      add('wage_statements', document.id)
      subject(document.config)
      add('payroll_subject_configs', document.config.id)
      for (const member of document.members) add('workers', member.workerId)
      for (const fact of document.daywork) {
        subject(fact)
        add('signed_daywork_records', fact.id)
      }
    }
    if (saved && (saved.formatFamily === 'C2' || Object.hasOwn(saved, 'c2Source') || Object.hasOwn(saved, 'c2Document')) && Object.hasOwn(saved, 'dayworkLinks')) {
      if (!Array.isArray(saved.dayworkLinks))
        invalid()
      const ids = new Set<string>()
      for (const link of saved.dayworkLinks) {
        if (!payrollObject(link) || Object.keys(link).some(key => key !== 'id' && key !== 'dayworkRecordId') || typeof link.id !== 'string' || !link.id || typeof link.dayworkRecordId !== 'string' || !link.dayworkRecordId || ids.has(link.id))
          invalid()
        ids.add(link.id)
        add('wage_statement_daywork_records', link.id)
        add('signed_daywork_records', link.dayworkRecordId)
      }
    }
  }
  function sourceRow(value: Record<string, unknown>) {
    subject({ projectId: value.project_id, leaderWorkerId: value.leader_worker_id })
    add('wage_statements', value.statement_id)
    source(parse(value.source_json))
  }
  for (const table of PAYROLL_C2_REFERENCE_TABLES) {
    for (const value of await tx.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) sourceRow(value)
  }
  for (const value of await tx.select<{ snapshot_json: string | null }>('SELECT snapshot_json FROM wage_statements')) snapshot(value.snapshot_json)
  const tables = [...PAYROLL_C2_REFERENCE_TABLES, 'wage_statements']
  const logs = await tx.select<{ table_name: string, record_id: string, before_data: string | null, after_data: string | null }>(`SELECT table_name,record_id,before_data,after_data FROM operation_logs WHERE table_name IN (${tables.map(() => '?').join(',')})`, tables)
  for (const log of logs) {
    if (log.table_name === 'payroll_c2_statement_sources')
      add('wage_statements', log.record_id)
    for (const value of [log.before_data, log.after_data]) {
      if (value === null)
        continue
      if (log.table_name === 'wage_statements')
        snapshot(payrollLogSnapshot(value)?.snapshot_json)
      else
        sourceRow(parse(value))
    }
  }
  return refs
}
