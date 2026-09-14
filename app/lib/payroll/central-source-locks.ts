import type { TransactionDb } from '../db/coordinator'
import type { PayrollSourceExclusion } from './central-attendance-contract'
import type { PayrollJsonObject } from './central-contract'
import type { PayrollDayworkOccupation, PayrollDayworkOccupationQuery } from './central-daywork-contract'
import type { PayrollEvidence, PayrollReadGraph, PayrollStoredRow } from './central-read'
import { payrollCanonical } from './central-command-shared'
import { loadPayrollGraph } from './central-read'
import { payrollObject, payrollText, readPayrollSnapshot } from './central-snapshot'

export interface PayrollSourceExclusionQuery { projectId: string, month: string, workerIds: string[], formatFamily: 'C1' | 'C2', statementId: string | null }
export type PayrollSourceProjectionQuery = Pick<PayrollSourceExclusionQuery, 'projectId' | 'formatFamily' | 'statementId'> & Partial<Pick<PayrollSourceExclusionQuery, 'month' | 'workerIds'>>
export type PayrollExclusionGraph = Pick<PayrollReadGraph, 'statements' | 'members' | 'statementDaywork' | 'daywork' | 'attendance' | 'evidence'> & { c2Sources?: PayrollStoredRow[] }
export type PayrollDayworkOccupationGraph = Pick<PayrollReadGraph, 'statements' | 'statementDaywork' | 'daywork' | 'evidence'> & { c2Sources?: PayrollStoredRow[] }
function mappedWorker(evidence: PayrollEvidence | undefined, value: unknown) {
  const id = payrollText(value)
  return !id || !evidence ? id : evidence.mappings.find(m => m.tableName === 'workers' && (m.legacyId === id || m.centralId === id))?.centralId ?? null
}

/** 逐条领用独立于人员月锁：未发领用挡第二单抢源，不因此禁止原签工合法更正。 */
export function payrollDayworkOccupationsFromGraph(graph: PayrollDayworkOccupationGraph, query: PayrollDayworkOccupationQuery = {}): PayrollDayworkOccupation[] {
  const result: PayrollDayworkOccupation[] = []
  const wanted = query.recordIds ? new Set(query.recordIds) : null
  function mapping(evidence: PayrollEvidence | undefined, tableName: string, value: unknown) {
    const id = payrollText(value)
    return !id || !evidence ? id : evidence.mappings.find(row => row.tableName === tableName && (row.legacyId === id || row.centralId === id))?.centralId ?? null
  }
  function push(row: PayrollDayworkOccupation) {
    const original = graph.daywork.find(source => source.id === row.dayworkRecordId)
    if ((query.projectId === undefined || row.projectId === query.projectId || original?.project_id === query.projectId) && (wanted === null || wanted.has(row.dayworkRecordId)))
      result.push(row)
  }
  function evidenceFor(head: PayrollStoredRow | undefined) {
    return head && graph.evidence.find(entry => entry.entityId === head._evidenceId || entry.mappings.some(row => row.tableName === 'wage_statements' && row.centralId === head.id))
  }
  function occupation(head: PayrollStoredRow | undefined, statementId: string, recordId: string, kind: PayrollDayworkOccupation['kind'], evidence: PayrollEvidence | undefined, scope?: { projectId: string, month: string }): PayrollDayworkOccupation {
    const record = graph.daywork.find(row => row.id === recordId)
    return { dayworkRecordId: recordId, statementId, linkId: null, projectId: payrollText(head?.project_id) ?? scope?.projectId ?? payrollText(record?.project_id) ?? '', month: payrollText(head?.month) ?? scope?.month ?? payrollText(record?.work_date)?.slice(0, 7) ?? '', formatFamily: payrollText(head?.format_family), status: payrollText(head?.status), statementDeletedAt: payrollText(head?.deleted_at), linkDeletedAt: null, kind, evidenceId: evidence?.entityId ?? null, legacyRecordId: evidence?.mappings.find(row => row.tableName === 'signed_daywork_records' && row.centralId === recordId)?.legacyId ?? null }
  }
  for (const link of graph.statementDaywork) {
    const head = graph.statements.find(row => row.id === link.statement_id)
    if (head && head.status !== 'released' && (head.deleted_at !== null || link.deleted_at !== null))
      continue
    const evidence = evidenceFor(head)
    const recordId = mapping(evidence, 'signed_daywork_records', link.daywork_record_id)
    const statementId = payrollText(link.statement_id)
    if (!recordId || !statementId)
      continue
    push({ ...occupation(head, statementId, recordId, !head ? 'missing-head' : head.status === 'released' ? 'released-link' : 'active-link', evidence), linkId: mapping(evidence, 'wage_statement_daywork_records', link.id), linkDeletedAt: payrollText(link.deleted_at) })
  }
  function sourceFacts(source: unknown, head: PayrollStoredRow | undefined, statementId: string, kind: PayrollDayworkOccupation['kind'], evidence?: PayrollEvidence, projectId?: string) {
    if (!payrollObject(source) || source.schemaVersion !== 1 || !Array.isArray(source.facts))
      return
    for (const fact of source.facts) {
      const id = payrollObject(fact) ? mapping(evidence, 'signed_daywork_records', fact.id) : null
      if (id)
        push(occupation(head, statementId, id, kind, evidence, { projectId: projectId ?? '', month: payrollText(source.month) ?? '' }))
    }
  }
  for (const head of graph.statements) {
    if (head.status !== 'released')
      continue
    const evidence = evidenceFor(head)
    const snapshot = readPayrollSnapshot(payrollText(head.snapshot_json), true).data
    if (head.format_family === 'C2' && Array.isArray(snapshot?.dayworkLinks)) {
      for (const link of snapshot.dayworkLinks) {
        const id = payrollObject(link) ? mapping(evidence, 'signed_daywork_records', link.dayworkRecordId) : null
        if (id && payrollObject(link))
          push({ ...occupation(head, String(head.id), id, 'released-snapshot', evidence), linkId: mapping(evidence, 'wage_statement_daywork_records', link.id) })
      }
    }
    if (Array.isArray(snapshot?.dayworkRecords)) {
      for (const fact of snapshot.dayworkRecords) {
        const id = payrollObject(fact) ? mapping(evidence, 'signed_daywork_records', fact.id) : null
        if (id)
          push(occupation(head, String(head.id), id, 'released-snapshot', evidence))
      }
    }
    sourceFacts(snapshot?.c2Source, head, String(head.id), 'released-snapshot', evidence)
    if (payrollObject(snapshot?.c2Document) && Array.isArray(snapshot.c2Document.daywork)) {
      for (const fact of snapshot.c2Document.daywork) {
        const id = payrollObject(fact) ? mapping(evidence, 'signed_daywork_records', fact.id) : null
        if (id)
          push(occupation(head, String(head.id), id, 'released-snapshot', evidence))
      }
    }
  }
  for (const row of graph.c2Sources ?? []) {
    const head = graph.statements.find(head => head.id === row.statement_id)
    if (head && head.deleted_at !== null && head.status !== 'released')
      continue
    const source = readPayrollSnapshot(payrollText(row.source_json), false).data
    const statementId = payrollText(row.statement_id)
    if (statementId)
      sourceFacts(source, head, statementId, 'c2-source', evidenceFor(head), payrollText(row.project_id) ?? '')
  }
  return [...new Map(result.map(row => [payrollCanonical(row), row])).values()].sort((a, b) => payrollCanonical(a).localeCompare(payrollCanonical(b)))
}

export async function loadPayrollDayworkOccupations(tx: TransactionDb, query: PayrollDayworkOccupationQuery = {}): Promise<PayrollDayworkOccupation[]> {
  const graph: PayrollDayworkOccupationGraph = await loadPayrollGraph(tx)
  graph.c2Sources = await c2Sources(tx)
  return payrollDayworkOccupationsFromGraph(graph, query)
}
async function c2Sources(tx: TransactionDb): Promise<PayrollStoredRow[]> {
  return (await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_c2_statement_sources\'')).length ? tx.select<PayrollStoredRow>('SELECT * FROM payroll_c2_statement_sources ORDER BY statement_id') : []
}
/** 同一事务内的事实互斥；独立来源没有工资头时仍保留自己的真实身份。 */
export async function loadPayrollSourceExclusions(db: TransactionDb, query: PayrollSourceExclusionQuery): Promise<PayrollSourceExclusion[]> {
  const graph: PayrollExclusionGraph = await loadPayrollGraph(db)
  graph.c2Sources = await c2Sources(db)
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
    const c2 = released && row.format_family === 'C2' ? [frozen?.c2Source, frozen?.c2Document, readPayrollSnapshot(payrollText(graph.c2Sources?.find(source => source.statement_id === row.id)?.source_json), false).data].filter((source): source is PayrollJsonObject => payrollObject(source)) : []
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
      if (row.format_family === 'C2' && Array.isArray(frozen?.dayworkRecords))
        members.push(...frozen.dayworkRecords.filter((fact): fact is PayrollJsonObject => payrollObject(fact)).map(fact => fact.workerId))
      for (const source of c2) {
        if (payrollObject(source.subject)) {
          members.push(source.subject.leaderWorkerId)
          if (Array.isArray(source.subject.memberWorkerIds))
            members.push(...source.subject.memberWorkerIds)
        }
        for (const key of ['members', 'facts', 'daywork'] as const) {
          if (Array.isArray(source[key]))
            members.push(...source[key].filter((fact): fact is PayrollJsonObject => payrollObject(fact)).map(fact => fact.workerId))
        }
      }
    }
    const linked: PayrollStoredRow[] = graph.statementDaywork.filter(link => link.statement_id === row.id && (released || link.deleted_at === null))
    if (released && row.format_family === 'C2' && Array.isArray(frozen?.dayworkLinks))
      linked.push(...frozen.dayworkLinks.filter((link): link is PayrollJsonObject => payrollObject(link)).map(link => ({ daywork_record_id: link.dayworkRecordId })))
    for (const link of linked) {
      const daywork = graph.daywork.find(d => d.id === link.daywork_record_id)
        ?? (Array.isArray(evidence?.graph.daywork) ? evidence.graph.daywork.filter(payrollObject).find(d => d.id === link.daywork_record_id) : undefined)
      if (daywork)
        members.push(daywork.worker_id)
    }
    const months = new Set([String(row.month), ...(released && payrollText(frozen?.month) ? [String(frozen!.month)] : []), ...c2.map(source => payrollText(source.month)).filter((month): month is string => month !== null)])
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
