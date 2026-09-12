import type { PayrollHistoryEntry, PayrollJson, PayrollJsonObject } from './central-contract'
import type { PayrollEvidence, PayrollReadGraph, PayrollStoredRow } from './central-read'
import type { PayrollDb } from './statements'
import { payrollObject, payrollText } from './central-snapshot'

function parsed(value: unknown): PayrollJson | null {
  if (typeof value !== 'string')
    return null
  try {
    return JSON.parse(value) as PayrollJson
  }
  catch { return null }
}
function mappedReference(evidence: PayrollEvidence | undefined, tableName: string, value: unknown): string | null {
  const id = payrollText(value)
  if (!id || !evidence)
    return id
  if (tableName === 'projects' && id === evidence.graph.projectId)
    return evidence.projectId
  const mapping = evidence.mappings.find(row => row.tableName === tableName && row.legacyId === id)
  if (mapping?.centralId)
    return mapping.centralId
  return mapping && tableName === 'wage_statements' ? `payroll-report:${evidence.entityId}:${encodeURIComponent(id)}` : null
}
/** 活跃行和历史快照均可证明归属；不凭日志名称或金额相近猜工资关系。 */
export async function loadPayrollHistory(db: PayrollDb, graph: PayrollReadGraph, projectId: string, statementId?: string): Promise<PayrollHistoryEntry[]> {
  const heads = new Set(graph.statements.filter(row => row.project_id === projectId && (!statementId || row.id === statementId)).map(row => String(row.id)))
  const scope = new Map<string, Set<string>>([
    ['wage_statements', heads],
    ...(['lines', 'members', 'allocations', 'statementDaywork'] as const).map((key) => {
      const names = { lines: 'wage_statement_lines', members: 'wage_statement_members', allocations: 'wage_statement_allocations', statementDaywork: 'wage_statement_daywork_records' }
      return [names[key], new Set(graph[key].filter(row => heads.has(String(row.statement_id))).map(row => String(row.id)))] as [string, Set<string>]
    }),
  ])
  if (!statementId) {
    for (const [part, table] of [['configs', 'payroll_subject_configs'], ['attendance', 'attendance_records'], ['daywork', 'signed_daywork_records']] as const)
      scope.set(table, new Set(graph[part].filter(row => row.project_id === projectId).map(row => String(row.id))))
  }
  const physicalRows = new Map<string, PayrollStoredRow[]>([
    ['wage_statements', graph.statements],
    ['wage_statement_lines', graph.lines],
    ['wage_statement_members', graph.members],
    ['wage_statement_allocations', graph.allocations],
    ['wage_statement_daywork_records', graph.statementDaywork],
    ['payroll_subject_configs', graph.configs],
    ['attendance_records', graph.attendance],
    ['signed_daywork_records', graph.daywork],
  ])
  const rows = await db.select<PayrollStoredRow>('SELECT * FROM operation_logs ORDER BY created_at, id')
  return rows.filter((row) => {
    const ids = scope.get(String(row.table_name))
    if (!ids)
      return false
    if (ids.has(String(row.record_id)))
      return true
    // 原行尚存在时以真实所属为准，不能借旧快照把另一工资单的行拉入本单。
    if (physicalRows.get(String(row.table_name))?.some(record => record.id === row.record_id))
      return false
    const evidence = graph.evidence.find(item => item.mappings.some(mapping => mapping.tableName === 'operation_logs' && mapping.centralId === row.id))
    const snapshots = [parsed(row.before_data), parsed(row.after_data)].filter((value): value is PayrollJsonObject => payrollObject(value))
    // 只用本日志的可信迁移映射判断已知关系，输出仍保留 before/after 原文。
    return snapshots.some(snapshot => String(row.table_name) === 'wage_statements'
      ? mappedReference(evidence, 'projects', snapshot.project_id) === projectId && (!statementId || mappedReference(evidence, 'wage_statements', snapshot.id) === statementId)
      : 'statement_id' in snapshot ? heads.has(mappedReference(evidence, 'wage_statements', snapshot.statement_id) ?? '') : !statementId && mappedReference(evidence, 'projects', snapshot.project_id) === projectId)
  }).map(row => ({ id: String(row.id), tableName: String(row.table_name), recordId: String(row.record_id), operation: String(row.action), operatedAt: payrollText(row.created_at), operator: payrollText(row.operator), beforeData: parsed(row.before_data), afterData: parsed(row.after_data), beforeRaw: payrollText(row.before_data), afterRaw: payrollText(row.after_data) }))
}
