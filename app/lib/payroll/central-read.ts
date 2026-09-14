import type { PayrollAllocation, PayrollAttendance, PayrollConfig, PayrollDaywork, PayrollDayworkLink, PayrollDiagnostic, PayrollIdentityMapping, PayrollJsonObject, PayrollLine, PayrollMember, PayrollQuery, PayrollSourceLock, PayrollStatementDetail, PayrollStatementRow } from './central-contract'
import type { PayrollDb } from './statements'
import { selectVisibleSql } from '../db/soft-delete'
import { loadPayrollAReleasedDocuments } from './central-a-provenance'
import { loadPayrollC1ReleasedDocuments } from './central-c1-provenance'
import { loadPayrollC2ReleasedDocuments } from './central-c2-provenance'
import { payrollProblem } from './central-contract'
import { payrollNumber as number, payrollObject as object, readPayrollSnapshot, payrollText as text } from './central-snapshot'

export type PayrollStoredRow = Record<string, unknown>
export interface PayrollEvidence { entityId: string, projectId: string, graph: Record<string, unknown>, mappings: PayrollIdentityMapping[], diagnostics: PayrollDiagnostic[] }
export interface PayrollReadGraph {
  statements: PayrollStoredRow[]
  lines: PayrollStoredRow[]
  members: PayrollStoredRow[]
  allocations: PayrollStoredRow[]
  configs: PayrollStoredRow[]
  attendance: PayrollStoredRow[]
  daywork: PayrollStoredRow[]
  statementDaywork: PayrollStoredRow[]
  evidence: PayrollEvidence[]
  visibleStatementIds: Set<string>
  provenAReleaseIds: Set<string>
  provenC1ReleaseIds: Set<string>
  provenC2ReleaseIds: Set<string>
  workers: Map<string, string>
  projects: Map<string, string>
  crews: Map<string, string>
}
const tables = { statements: 'wage_statements', lines: 'wage_statement_lines', members: 'wage_statement_members', allocations: 'wage_statement_allocations', configs: 'payroll_subject_configs', attendance: 'attendance_records', daywork: 'signed_daywork_records', statementDaywork: 'wage_statement_daywork_records' } as const
function records(value: unknown): PayrollStoredRow[] {
  return Array.isArray(value) ? value.filter(object) : []
}
function diagnostic(code: string, message: string, id: string, field: string | null = null): PayrollDiagnostic {
  return { code, message, tableName: 'wage_statements', recordId: id, field }
}
export async function loadPayrollGraph(db: PayrollDb): Promise<PayrollReadGraph> {
  const values = await Promise.all(Object.values(tables).map(table => db.select<PayrollStoredRow>(`SELECT * FROM ${table} ORDER BY id`)))
  const graph = Object.fromEntries(Object.keys(tables).map((key, index) => [key, values[index]!])) as unknown as PayrollReadGraph
  graph.evidence = []
  if ((await db.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_migration_evidence\'')).length) {
    for (const row of await db.select<PayrollStoredRow>('SELECT * FROM payroll_migration_evidence ORDER BY entity_id')) {
      const source: unknown = JSON.parse(String(row.source_graph_json))
      graph.evidence.push({ entityId: String(row.entity_id), projectId: String(row.project_id), graph: object(source) ? source : {}, mappings: JSON.parse(String(row.mapping_json)), diagnostics: JSON.parse(String(row.diagnostics_json)) })
    }
  }
  graph.visibleStatementIds = new Set((await db.select<{ id: string }>(selectVisibleSql('wage_statements'))).map(row => row.id))
  graph.provenAReleaseIds = new Set((await loadPayrollAReleasedDocuments(db)).keys())
  graph.provenC1ReleaseIds = new Set((await loadPayrollC1ReleasedDocuments(db)).keys())
  graph.provenC2ReleaseIds = new Set((await loadPayrollC2ReleasedDocuments(db)).keys())
  for (const table of ['workers', 'projects', 'crews'] as const) {
    graph[table] = new Map((await db.select<{ id: string, name: string }>(selectVisibleSql(table))).map(row => [row.id, row.name]))
  }
  // 隔离报告身份只属于只读证据，绝不写回业务表或冒充可维护工资单。
  for (const evidence of graph.evidence) {
    for (const row of records(evidence.graph.statements)) {
      const mapping = evidence.mappings.find(m => m.tableName === 'wage_statements' && m.legacyId === row.id)
      if (mapping?.centralId)
        continue
      const id = `payroll-report:${evidence.entityId}:${encodeURIComponent(String(row.id))}`
      graph.statements.push({ ...row, id, project_id: evidence.projectId, _isolated: true, _legacyId: row.id, _evidenceId: evidence.entityId })
      for (const part of ['lines', 'members', 'allocations', 'statementDaywork'] as const) {
        graph[part].push(...records(evidence.graph[part]).filter(child => child.statement_id === row.id).map(child => ({ ...child, statement_id: id })))
      }
    }
  }
  return graph
}
function evidenceFor(graph: PayrollReadGraph, id: string) {
  return graph.evidence.find(e => e.mappings.some(m => m.tableName === 'wage_statements' && (m.centralId === id || `payroll-report:${e.entityId}:${encodeURIComponent(m.legacyId)}` === id)))
}
function originalFor(evidence: PayrollEvidence | undefined, id: string) {
  const legacyId = evidence?.mappings.find(m => m.tableName === 'wage_statements' && (m.centralId === id || `payroll-report:${evidence.entityId}:${encodeURIComponent(m.legacyId)}` === id))?.legacyId
  return { legacyId: legacyId ?? null, row: records(evidence?.graph.statements).find(row => row.id === legacyId) }
}
function mapFrozenId(evidence: PayrollEvidence | undefined, tableName: string, value: unknown): string | null {
  const id = text(value)
  if (!id || !evidence)
    return id
  return evidence.mappings.find(m => m.tableName === tableName && (m.legacyId === id || m.centralId === id))?.centralId ?? null
}
export function payrollStatementRow(row: PayrollStoredRow, graph: PayrollReadGraph, evidence = evidenceFor(graph, String(row.id)), isolated = false): PayrollStatementRow {
  const id = String(row.id)
  const original = originalFor(evidence, id)
  const released = row.status === 'released'
  const snapshot = readPayrollSnapshot(text(row.snapshot_json), released, original.row ? text(original.row.snapshot_json) : text(row.snapshot_json))
  const frozen = snapshot.data
  const provenARelease = graph.provenAReleaseIds.has(id)
  const provenC1Release = graph.provenC1ReleaseIds?.has(id) ?? false
  const provenC2Release = graph.provenC2ReleaseIds?.has(id) ?? false
  if (released && row.format_family === 'A' && frozen && ('aSource' in frozen || 'aDocument' in frozen) && !provenARelease) {
    snapshot.state = 'partial'
    snapshot.issues.push('中央 A 发放的原来源、冻结内容或成功回执无法相互核实')
  }
  if (released && row.format_family === 'C1' && frozen && ('c1Source' in frozen || 'c1Document' in frozen) && !provenC1Release) {
    snapshot.state = 'partial'
    snapshot.issues.push('中央 C1 的原考勤、个人标准、冻结内容或成功回执无法相互核实')
  }
  if (released && row.format_family === 'C2' && frozen && ('c2Source' in frozen || 'c2Document' in frozen) && !provenC2Release) {
    snapshot.state = 'partial'
    snapshot.issues.push('中央 C2 的原签工、主体配置、冻结内容或成功回执无法相互核实')
  }
  const value = (key: string, column: string) => released ? frozen?.[key] : row[column]
  const diagnostics = [...(evidence?.diagnostics.filter(d => d.recordId === original.legacyId || d.recordId === id || d.recordId === null) ?? [])]
  diagnostics.push(...snapshot.issues.map(message => diagnostic(`snapshot-${snapshot.state}`, message, id, 'snapshot_json')))
  if (row.format_family === 'B')
    diagnostics.push(diagnostic('retired-b', 'B 类已退役，仅保留历史，不参与新工资及成本', id, 'format_family'))
  if ((row.format_family === 'A' && !provenARelease) || (row.format_family === 'C1' && !provenC1Release))
    diagnostics.push(diagnostic('source-unproven', '旧汇总未保存完整施工责任或考勤行身份，不能据当前资料补造历史计薪资格', id, 'source_version'))
  if (released && row.format_family === 'C2' && !provenC2Release)
    diagnostics.push(diagnostic('source-unproven', '原签工、主体配置或完整发放证据尚未证实，不能据当前资料补造历史计薪资格', id, 'source_version'))
  if (!graph.visibleStatementIds.has(id))
    diagnostics.push(diagnostic('historical-scope', '工资单或其档案关系已隐藏，仅用于历史核对', id))
  const frozenFields = { month: 'month', formatFamily: 'format_family', quantitySource: 'quantity_source', sourceVersion: 'source_version', payRatio: 'pay_ratio', cumulativeAmount: 'cumulative_amount', previouslyPaid: 'previously_paid', grossAmount: 'gross_amount', actualAmount: 'actual_amount' }
  if (released && frozen && Object.entries(frozenFields).some(([key, column]) => {
    const savedValue = number(row[column]) ?? text(row[column])
    const frozenValue = number(frozen[key]) ?? text(frozen[key])
    return savedValue !== null && frozenValue !== null && savedValue !== frozenValue
  })) {
    diagnostics.push(diagnostic('snapshot-row-mismatch', '保存的工资头与发放快照不同；发放呈现使用原快照，原行另行保留', id))
  }
  return {
    id,
    recordKind: isolated || row._isolated ? 'isolated' : 'central',
    legacyId: original.legacyId,
    projectId: String(row.project_id),
    projectName: released ? text(frozen?.projectName) : graph.projects.get(String(row.project_id)) ?? null,
    crewId: text(row.crew_id),
    crewName: released ? text(frozen?.crewName) : graph.crews.get(String(row.crew_id)) ?? null,
    leaderWorkerId: String(row.leader_worker_id),
    leaderName: released ? text(frozen?.leaderName) : graph.workers.get(String(row.leader_worker_id)) ?? null,
    subjectConfigId: text(row.subject_config_id),
    month: text(value('month', 'month')) ?? String(row.month),
    formatFamily: text(value('formatFamily', 'format_family')) ?? String(row.format_family),
    periodKind: text(value('periodKind', 'period_kind')) ?? String(row.period_kind),
    purpose: String(row.purpose),
    quantitySource: text(value('quantitySource', 'quantity_source')) ?? String(row.quantity_source),
    status: String(row.status),
    needsRecheck: row.needs_recheck === 1,
    payRatio: number(value('payRatio', 'pay_ratio')),
    cumulativeAmount: number(value('cumulativeAmount', 'cumulative_amount')),
    previouslyPaid: number(value('previouslyPaid', 'previously_paid')),
    grossAmount: number(value('grossAmount', 'gross_amount')),
    actualAmount: number(value('actualAmount', 'actual_amount')),
    checkedAt: text(row.checked_at),
    releasedAt: text(row.released_at),
    submittedAt: text(value('submittedAt', 'submitted_at')),
    updatedAt: text(row.updated_at),
    deletedAt: text(row.deleted_at),
    hidden: isolated || !!row._isolated || !graph.visibleStatementIds.has(id),
    sourceVersion: text(value('sourceVersion', 'source_version')) ?? '',
    note: text(value('note', 'note')),
    snapshot,
    diagnostics,
  }
}
function mapLine(row: PayrollStoredRow, statementId: string, graph: PayrollReadGraph, frozen = false, evidence?: PayrollEvidence): PayrollLine {
  const workerId = frozen ? mapFrozenId(evidence, 'workers', row.workerId) : text(row.worker_id)
  return { id: text(row.id), statementId, workerId, workerName: frozen ? text(row.workerName) : graph.workers.get(workerId ?? '') ?? null, itemId: frozen ? mapFrozenId(evidence, 'items', row.itemId) : text(row.item_id), itemName: text(frozen ? row.itemName : row.item_name), unit: text(row.unit), quantity: number(row.quantity), unitPrice: number(frozen ? row.unitPrice : row.unit_price), amount: number(row.amount), sortOrder: number(frozen ? row.sortOrder : row.sort_order), deletedAt: frozen ? null : text(row.deleted_at) }
}
function mapMember(row: PayrollStoredRow, statementId: string, graph: PayrollReadGraph, frozen = false, evidence?: PayrollEvidence): PayrollMember {
  const workerId = frozen ? mapFrozenId(evidence, 'workers', row.workerId) : text(row.worker_id)
  return { id: text(row.id), statementId, workerId, workerName: frozen ? text(row.workerName) : graph.workers.get(workerId ?? '') ?? null, isLeader: frozen ? row.isLeader === true : row.is_leader === 1, deletedAt: frozen ? null : text(row.deleted_at) }
}
function mapAllocation(row: PayrollStoredRow, statementId: string, graph: PayrollReadGraph, frozen = false, evidence?: PayrollEvidence): PayrollAllocation {
  const fen = number(frozen ? row.allocatedAmountFen : row.allocated_amount_fen)
  return { ...mapMember(row, statementId, graph, frozen, evidence), amount: frozen ? number(row.amount) : fen === null ? null : fen / 100, allocatedAmountFen: fen }
}
export function payrollDaywork(row: PayrollStoredRow, graph: PayrollReadGraph): PayrollDaywork {
  return { id: String(row.id), projectId: String(row.project_id), crewId: text(row.crew_id), workerId: String(row.worker_id), workerName: graph.workers.get(String(row.worker_id)) ?? null, workDate: String(row.work_date), workContent: text(row.work_content), startTime: text(row.start_time), endTime: text(row.end_time), laborUnits: number(row.labor_units), witness: text(row.witness), confirmedOn: text(row.confirmed_on), status: String(row.status), note: text(row.note), deletedAt: text(row.deleted_at) }
}
function dayworkLink(row: PayrollStoredRow): PayrollDayworkLink {
  return { id: String(row.id), statementId: String(row.statement_id), dayworkRecordId: String(row.daywork_record_id), deletedAt: text(row.deleted_at) }
}
/** 源锁不以金额、工时或行数推断；发放的历史锁不因父对象或关系软删消失。 */
export function payrollSourceLocks(graph: PayrollReadGraph): PayrollSourceLock[] {
  const locks: PayrollSourceLock[] = []
  for (const row of graph.statements) {
    if (row.format_family !== 'C1' && row.format_family !== 'C2')
      continue
    const released = row.status === 'released'
    if (!released && row.deleted_at !== null)
      continue
    const id = String(row.id)
    const evidence = evidenceFor(graph, id)
    const snapshot = readPayrollSnapshot(text(row.snapshot_json), released).data
    const workers = new Set<string>([String(row.leader_worker_id)])
    for (const member of graph.members.filter(m => m.statement_id === row.id && (m.deleted_at === null || (released && !Array.isArray(snapshot?.memberWorkerIds)))))
      workers.add(String(member.worker_id))
    if (released && Array.isArray(snapshot?.memberWorkerIds)) {
      for (const worker of snapshot.memberWorkerIds) {
        const mapped = mapFrozenId(evidence, 'workers', worker)
        if (mapped)
          workers.add(mapped)
      }
    }
    const base: Pick<PayrollSourceLock, 'projectId' | 'month' | 'statementId' | 'formatFamily'> = { projectId: String(row.project_id), month: released ? text(snapshot?.month) ?? String(row.month) : String(row.month), statementId: id, formatFamily: row.format_family }
    if (released || row.format_family === 'C2') {
      for (const workerId of workers)
        locks.push({ ...base, workerId, kind: released ? 'released-month' : 'format-exclusion', dayworkRecordId: null })
    }
    for (const link of graph.statementDaywork.filter(l => l.statement_id === row.id && (l.deleted_at === null || released))) {
      const source = graph.daywork.find(d => d.id === link.daywork_record_id)
      if (source)
        locks.push({ ...base, workerId: String(source.worker_id), kind: 'daywork-occupation', dayworkRecordId: String(link.daywork_record_id) })
    }
  }
  return [...new Map(locks.map(lock => [JSON.stringify(lock), lock])).values()]
}
export function payrollListRows(graph: PayrollReadGraph, query: PayrollQuery): PayrollStatementRow[] {
  return graph.statements.map(row => payrollStatementRow(row, graph)).filter(row => (!query.projectId || row.projectId === query.projectId) && (!query.month || row.month === query.month) && (!query.crewId || row.crewId === query.crewId))
}
export async function readPayrollStatement(db: PayrollDb, id: string, existingGraph?: PayrollReadGraph): Promise<PayrollStatementDetail> {
  const graph = existingGraph ?? await loadPayrollGraph(db)
  const row = graph.statements.find(row => row.id === id)
  if (!row)
    throw payrollProblem('not-found', '工资单不存在')
  const statement = payrollStatementRow(row, graph)
  const evidence = evidenceFor(graph, id)
  const savedLines = graph.lines.filter(line => line.statement_id === id).map(line => mapLine(line, id, graph))
  const savedMembers = graph.members.filter(member => member.statement_id === id).map(member => mapMember(member, id, graph))
  const savedAllocations = graph.allocations.filter(allocation => allocation.statement_id === id).map(allocation => mapAllocation(allocation, id, graph))
  const savedLinks = graph.statementDaywork.filter(link => link.statement_id === id).map(dayworkLink)
  const released = statement.status === 'released'
  const frozen = statement.snapshot.data
  const frozenNames = new Map(records(frozen?.members).map(member => [member.workerId, text(member.workerName)]))
  const frozenDaywork = records(frozen?.dayworkRecords).map(source => ({ id: mapFrozenId(evidence, 'signed_daywork_records', source.id) ?? String(source.id ?? ''), projectId: statement.projectId, crewId: mapFrozenId(evidence, 'crews', source.crewId), workerId: mapFrozenId(evidence, 'workers', source.workerId) ?? '', workerName: Object.hasOwn(source, 'workerName') ? text(source.workerName) : frozenNames.get(source.workerId) ?? null, workDate: text(source.workDate) ?? '', workContent: text(source.workContent), startTime: text(source.startTime), endTime: text(source.endTime), laborUnits: number(source.laborUnits), witness: text(source.witness), confirmedOn: text(source.confirmedOn), status: text(source.status) ?? '', note: text(source.note), deletedAt: null }))
  return { ...statement, lines: released ? records(frozen?.lines).map(line => mapLine({ ...line, workerName: text(line.workerName) ?? frozenNames.get(line.workerId) ?? null }, id, graph, true, evidence)) : savedLines.filter(line => line.deletedAt === null), members: released ? records(frozen?.members).map(member => mapMember(member, id, graph, true, evidence)) : savedMembers.filter(member => member.deletedAt === null), allocations: released ? records(frozen?.allocations).map(allocation => mapAllocation(allocation, id, graph, true, evidence)) : savedAllocations.filter(allocation => allocation.deletedAt === null), daywork: released ? frozenDaywork : graph.daywork.filter(source => savedLinks.some(link => link.deletedAt === null && link.dayworkRecordId === source.id)).map(source => payrollDaywork(source, graph)), dayworkLinks: savedLinks, stored: { head: row as PayrollJsonObject, lines: savedLines, members: savedMembers, allocations: savedAllocations, dayworkLinks: savedLinks }, locks: payrollSourceLocks(graph).filter(lock => lock.statementId === id) }
}
export function payrollSources(graph: PayrollReadGraph, query: PayrollQuery & { projectId: string }) {
  const inScope = (row: PayrollStoredRow, date?: string) => row.project_id === query.projectId && (!query.crewId || row.crew_id === query.crewId) && (!date || !query.month || String(row[date]).startsWith(query.month))
  const configs: PayrollConfig[] = graph.configs.filter(row => inScope(row)).map(row => ({ id: String(row.id), projectId: String(row.project_id), crewId: text(row.crew_id), leaderWorkerId: String(row.leader_worker_id), formatFamily: String(row.format_family), unitRate: number(row.unit_rate), ruleText: text(row.rule_text), enabled: row.enabled === 1 ? true : row.enabled === 0 ? false : null, updatedAt: text(row.updated_at), deletedAt: text(row.deleted_at) }))
  const attendance: PayrollAttendance[] = graph.attendance.filter(row => inScope(row, 'work_date')).map(row => ({ id: String(row.id), projectId: String(row.project_id), crewId: text(row.crew_id), workerId: String(row.worker_id), workerName: graph.workers.get(String(row.worker_id)) ?? null, workDate: String(row.work_date), hours: number(row.hours), overtimeHours: number(row.overtime_hours), workContent: text(row.work_content), note: text(row.note), deletedAt: text(row.deleted_at) }))
  const scopeStatements = new Set(graph.statements.filter(row => inScope(row)).map(row => String(row.id)))
  return { projectId: query.projectId, configs, attendance, daywork: graph.daywork.filter(row => inScope(row, 'work_date')).map(row => payrollDaywork(row, graph)), locks: payrollSourceLocks(graph).filter(lock => scopeStatements.has(lock.statementId) && (!query.month || lock.month === query.month)), diagnostics: graph.evidence.filter(e => e.projectId === query.projectId).flatMap(e => e.diagnostics) }
}
export function payrollEvidence(graph: PayrollReadGraph, projectId: string) {
  return graph.evidence.filter(e => e.projectId === projectId).map(e => ({ entityId: e.entityId, source: e.graph as PayrollJsonObject, mappings: e.mappings }))
}
