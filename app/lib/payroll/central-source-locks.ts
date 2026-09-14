import type { TransactionDb } from '../db/coordinator'
import type { PayrollSourceExclusion } from './central-attendance-contract'
import type { PayrollEvidence, PayrollReadGraph, PayrollStoredRow } from './central-read'
import { payrollCanonical } from './central-command-shared'
import { loadPayrollGraph } from './central-read'
import { payrollObject, payrollText, readPayrollSnapshot } from './central-snapshot'

export interface PayrollSourceExclusionQuery { projectId: string, month: string, workerIds: string[], formatFamily: 'C1' | 'C2', statementId: string | null }
export type PayrollSourceProjectionQuery = Pick<PayrollSourceExclusionQuery, 'projectId' | 'formatFamily' | 'statementId'> & Partial<Pick<PayrollSourceExclusionQuery, 'month' | 'workerIds'>>
export type PayrollExclusionGraph = Pick<PayrollReadGraph, 'statements' | 'members' | 'statementDaywork' | 'daywork' | 'attendance' | 'evidence'>
function mappedWorker(evidence: PayrollEvidence | undefined, value: unknown) {
  const id = payrollText(value)
  return !id || !evidence ? id : evidence.mappings.find(m => m.tableName === 'workers' && (m.legacyId === id || m.centralId === id))?.centralId ?? null
}
/** 同一事务内的事实互斥；独立来源没有工资头时仍保留自己的真实身份。 */
export async function loadPayrollSourceExclusions(db: TransactionDb, query: PayrollSourceExclusionQuery): Promise<PayrollSourceExclusion[]> {
  const graph = await loadPayrollGraph(db)
  return payrollSourceExclusionsFromGraph(graph, query)
}

/** 日常命令与迁入候选共同使用；调用者提供原图，不裁软删关系或改写缺损日期。 */
export function payrollSourceExclusionsFromGraph(graph: PayrollExclusionGraph, query: PayrollSourceProjectionQuery): PayrollSourceExclusion[] {
  const result: PayrollSourceExclusion[] = []
  const wanted = query.workerIds ? new Set(query.workerIds) : null
  const push = (lock: PayrollSourceExclusion) => {
    if (lock.projectId === query.projectId && (query.month === undefined || lock.month === query.month) && (wanted === null || wanted.has(lock.workerId)))
      result.push(lock)
  }
  for (const row of graph.statements) {
    if (!['C1', 'C2'].includes(String(row.format_family)) || row.id === query.statementId)
      continue
    const released = row.status === 'released'
    if (!released && (row.deleted_at !== null || row.format_family === query.formatFamily))
      continue
    const evidence = graph.evidence.find(e => e.entityId === row._evidenceId || e.mappings.some(m => m.tableName === 'wage_statements' && m.centralId === row.id))
    const frozen = readPayrollSnapshot(payrollText(row.snapshot_json), released).data
    const members: unknown[] = [row.leader_worker_id, ...graph.members.filter(m => m.statement_id === row.id && (released || m.deleted_at === null)).map(m => m.worker_id)]
    if (released && Array.isArray(frozen?.memberWorkerIds))
      members.push(...frozen.memberWorkerIds)
    if (released) {
      for (const key of ['members', 'allocations', 'lines'] as const) {
        if (Array.isArray(frozen?.[key])) {
          for (const member of frozen[key]) {
            if (payrollObject(member))
              members.push(member.workerId)
          }
        }
      }
      members.push(frozen?.leaderWorkerId)
    }
    const linked = graph.statementDaywork.filter(link => link.statement_id === row.id && (released || link.deleted_at === null))
    for (const link of linked) {
      const daywork = graph.daywork.find(d => d.id === link.daywork_record_id)
        ?? (Array.isArray(evidence?.graph.daywork) ? evidence.graph.daywork.filter(payrollObject).find(d => d.id === link.daywork_record_id) : undefined)
      if (daywork)
        members.push(daywork.worker_id)
    }
    const months = new Set([String(row.month), ...(released && payrollText(frozen?.month) ? [String(frozen!.month)] : [])])
    for (const value of members) {
      const workerId = mappedWorker(evidence, value)
      if (workerId) {
        for (const month of months)
          push({ projectId: String(row.project_id), month, workerId, formatFamily: row.format_family as 'C1' | 'C2', kind: released ? 'released-month' : 'format-exclusion', statementId: String(row.id), dayworkRecordId: null, attendanceRecordId: null, evidenceId: row._isolated ? evidence?.entityId ?? null : null, legacyRecordId: row._isolated ? payrollText(row._legacyId) : null })
      }
    }
  }
  const part = query.formatFamily === 'C1' ? 'daywork' : 'attendance'
  const table = part === 'daywork' ? 'signed_daywork_records' : 'attendance_records'
  function source(row: PayrollStoredRow, evidence?: PayrollEvidence) {
    if (row.deleted_at !== null && row.deleted_at !== undefined)
      return
    const workerId = mappedWorker(evidence, row.worker_id)
    const date = payrollText(row.work_date)
    if (!workerId || !date)
      return
    const mapping = evidence?.mappings.find(m => m.tableName === table && m.legacyId === row.id)
    const id = evidence ? mapping?.centralId ?? null : String(row.id)
    push({ projectId: evidence?.projectId ?? String(row.project_id), month: date.slice(0, 7), workerId, formatFamily: part === 'daywork' ? 'C2' : 'C1', kind: part === 'daywork' ? 'daywork-occupation' : 'format-exclusion', statementId: null, dayworkRecordId: part === 'daywork' ? id : null, attendanceRecordId: part === 'attendance' ? id : null, evidenceId: evidence?.entityId ?? null, legacyRecordId: evidence ? String(row.id) : null })
  }
  graph[part].forEach(row => source(row))
  for (const evidence of graph.evidence) {
    if (!Array.isArray(evidence.graph[part]))
      continue
    for (const row of evidence.graph[part]) {
      if (payrollObject(row) && !evidence.mappings.some(m => m.tableName === table && m.legacyId === row.id && m.centralId))
        source(row, evidence)
    }
  }
  return [...new Map(result.map(row => [payrollCanonical(row), row])).values()].sort((a, b) => payrollCanonical(a).localeCompare(payrollCanonical(b)))
}
