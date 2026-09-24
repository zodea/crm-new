import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollC2ConfigFact, PayrollC2ConfigFacts, PayrollC2ConfigScope } from '../../app/lib/payroll/central-c2-contract'
import type { PayrollIdentityMapping, PayrollJsonObject, PayrollSourceDiagnostic, PayrollSourceEvidence } from '../../app/lib/payroll/central-contract'
import type { PayrollDayworkFact, PayrollDayworkFacts, PayrollDayworkRecordFacts } from '../../app/lib/payroll/central-daywork-contract'
import { createHash } from 'node:crypto'
import { parsePayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { payrollObject } from '../../app/lib/payroll/central-snapshot'
import { loadPayrollDayworkOccupations } from '../../app/lib/payroll/central-source-locks'
import { isISODateDTO } from '../../app/types/read-model'

function hash(value: unknown) {
  return createHash('sha256').update(payrollCanonical(value)).digest('hex')
}
function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
function daywork(row: PayrollJsonObject): PayrollDayworkFact {
  return { id: text(row.id) ?? '', projectId: text(row.project_id) ?? '', crewId: text(row.crew_id), workerId: text(row.worker_id) ?? '', workDate: text(row.work_date) ?? '', workContent: text(row.work_content), startTime: text(row.start_time), endTime: text(row.end_time), laborUnits: finite(row.labor_units), witness: text(row.witness), confirmedOn: text(row.confirmed_on), status: text(row.status), note: text(row.note), createdAt: text(row.created_at), updatedAt: text(row.updated_at), deletedAt: text(row.deleted_at), sourceFingerprint: hash(row), original: row }
}
function diagnostic(row: PayrollJsonObject, tableName: string, code: string, message: string, field: string | null = null): PayrollSourceDiagnostic {
  return { code, message, recordId: text(row.id), workerId: text(row.worker_id ?? row.leader_worker_id), field, tableName, entityId: null, legacyRecordId: null }
}
function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}
async function subjectDiagnostics(tx: TransactionDb, rows: PayrollJsonObject[], tableName: string) {
  const result: PayrollSourceDiagnostic[] = []
  const subjects = new Map<string, Map<string, unknown>>()
  for (const table of ['projects', 'workers', 'crews'])
    subjects.set(table, new Map((await tx.select<{ id: string, deleted_at: unknown }>(`SELECT id,deleted_at FROM ${table}`)).map(row => [row.id, row.deleted_at])))
  for (const row of rows) {
    for (const [field, table] of [['project_id', 'projects'], ['worker_id', 'workers'], ['leader_worker_id', 'workers'], ['crew_id', 'crews']] as const) {
      if (!(field in row) || (field === 'crew_id' && row[field] === null))
        continue
      const id = text(row[field])
      if (id === null || !subjects.get(table)!.has(id) || subjects.get(table)!.get(id) !== null)
        result.push(diagnostic(row, tableName, tableName === 'signed_daywork_records' ? 'daywork-subject-unavailable' : 'c2-config-subject-unavailable', '原关联档案缺失或隐藏；保留原身份，不按当前名册补接', field))
    }
  }
  return result
}
async function dayworkDiagnostics(tx: TransactionDb, raw: PayrollJsonObject[]) {
  const diagnostics = await subjectDiagnostics(tx, raw, 'signed_daywork_records')
  for (const row of raw) {
    const add = (code: string, message: string, field: string) => diagnostics.push(diagnostic(row, 'signed_daywork_records', code, message, field))
    if (!isISODateDTO(row.work_date))
      add('daywork-date-invalid', '原签工日期无法确认，不能证明所属月份完整', 'work_date')
    if (!validTime(row.start_time) || !validTime(row.end_time) || row.start_time >= row.end_time)
      add('daywork-time-invalid', '原签工起止时间缺失、非法或不在同一日顺序内', 'start_time')
    if (row.labor_units !== 0.5 && row.labor_units !== 1)
      add('daywork-units-invalid', '原工数必须明确为半工或一工，不能从时长或坏值推算', 'labor_units')
    if (typeof row.work_content !== 'string' || !row.work_content.trim())
      add('daywork-content-invalid', '原签工内容缺失', 'work_content')
    if (row.status !== 'draft' && row.status !== 'confirmed')
      add('daywork-status-invalid', '原签工状态无法确认', 'status')
    if (row.status === 'confirmed' && (typeof row.witness !== 'string' || !row.witness.trim() || !isISODateDTO(row.confirmed_on) || !isISODateDTO(row.work_date) || row.confirmed_on < row.work_date))
      add('daywork-proof-invalid', '已确认原签工缺少有效证明人或确认日期', 'confirmed_on')
    if (row.deleted_at !== null || !isISODateDTO(row.work_date))
      continue
    const peers = raw.filter(other => other.deleted_at === null && other.worker_id === row.worker_id && other.project_id === row.project_id && other.work_date === row.work_date)
    if (peers.reduce((sum, other) => sum + (other.labor_units === 0.5 || other.labor_units === 1 ? other.labor_units : 0), 0) > 1)
      add('daywork-day-units-exceeded', '同人同日原签工合计超过一工，待确认也计入日内检查', 'labor_units')
    const startTime = row.start_time
    const endTime = row.end_time
    if (validTime(startTime) && validTime(endTime) && peers.some(other => other.id !== row.id && validTime(other.start_time) && validTime(other.end_time) && startTime < other.end_time && endTime > other.start_time))
      add('daywork-time-overlap', '同人同日原签工时段重叠', 'start_time')
  }
  return diagnostics
}
function identityMappings(value: unknown): PayrollIdentityMapping[] {
  if (!Array.isArray(value) || !value.every(row => payrollObject(row) && typeof row.tableName === 'string' && typeof row.legacyId === 'string' && (row.centralId === null || typeof row.centralId === 'string')))
    throw payrollProblem('validation-failed', '原签工身份映射无法确认')
  return value
}
async function sourceEvidence(tx: TransactionDb, projectId: string | null, table: 'signed_daywork_records' | 'payroll_subject_configs', relevant: (row: PayrollMigrationRow, map: PayrollIdentityMapping[]) => boolean) {
  const evidence: PayrollSourceEvidence[] = []
  const diagnostics: PayrollSourceDiagnostic[] = []
  const part = table === 'signed_daywork_records' ? 'daywork' : 'configs'
  if (!(await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_migration_evidence\'')).length)
    return { evidence, diagnostics }
  const saved = await tx.select<{ entity_id: string, source_graph_json: string, mapping_json: string }>(`SELECT entity_id,source_graph_json,mapping_json FROM payroll_migration_evidence${projectId === null ? '' : ' WHERE project_id=?'} ORDER BY entity_id`, projectId === null ? [] : [projectId])
  for (const entry of saved) {
    const source = parsePayrollProjectGraph(JSON.parse(entry.source_graph_json))
    const mappings = identityMappings(JSON.parse(entry.mapping_json))
    const rows = source[part].filter(row => relevant(row, mappings))
    if (!rows.length)
      continue
    evidence.push({ entityId: entry.entity_id, source: { ...source }, mappings })
    for (const row of rows) {
      if (mappings.some(mapping => mapping.tableName === table && mapping.legacyId === row.id && mapping.centralId !== null))
        continue
      const workerId = mappings.find(mapping => mapping.tableName === 'workers' && mapping.legacyId === row.worker_id)?.centralId ?? mappings.find(mapping => mapping.tableName === 'workers' && mapping.legacyId === row.leader_worker_id)?.centralId ?? null
      diagnostics.push({ code: part === 'daywork' ? 'daywork-isolated' : 'c2-config-isolated', message: '原身份、关系或字段无法确认为可用来源；完整原行保留在迁入证据中', recordId: null, workerId, field: null, tableName: table, entityId: entry.entity_id, legacyRecordId: text(row.id) })
    }
  }
  return { evidence, diagnostics }
}
async function occupationFacts(tx: TransactionDb, rows: PayrollDayworkFact[]) {
  const occupations = await loadPayrollDayworkOccupations(tx, { recordIds: rows.map(row => row.id) })
  const diagnostics: PayrollSourceDiagnostic[] = []
  for (const row of rows) {
    const used = occupations.filter(occupation => occupation.dayworkRecordId === row.id)
    const broken = used.filter(occupation => occupation.kind === 'missing-head' || occupation.status === null || occupation.formatFamily !== 'C2' || occupation.projectId !== row.projectId || occupation.month !== row.workDate.slice(0, 7))
    for (const occupation of broken)
      diagnostics.push({ code: 'daywork-occupation-invalid', message: '原领用关系缺头、格式或范围不一致，不能据此放开重复计薪', recordId: row.id, workerId: row.workerId, field: 'daywork_record_id', tableName: 'wage_statement_daywork_records', entityId: occupation.evidenceId, legacyRecordId: occupation.legacyRecordId })
    if (new Set(used.map(occupation => occupation.statementId)).size > 1)
      diagnostics.push(diagnostic(row.original, 'wage_statement_daywork_records', 'daywork-occupation-duplicate', '同一原签工存在多张工资领用关系，不能重复计薪', 'daywork_record_id'))
  }
  // 版本封闭实际关联原头/源表原文；同状态但改快照正文不能继续使用旧读版本。
  const related: unknown[] = []
  const hasSources = (await tx.select('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'payroll_c2_statement_sources\'')).length > 0
  for (const statementId of [...new Set(occupations.map(row => row.statementId))].sort()) {
    related.push(await tx.select('SELECT * FROM wage_statements WHERE id=?', [statementId]), await tx.select('SELECT * FROM wage_statement_daywork_records WHERE statement_id=? ORDER BY id', [statementId]))
    if (hasSources)
      related.push(await tx.select('SELECT * FROM payroll_c2_statement_sources WHERE statement_id=?', [statementId]))
  }
  return { occupations, diagnostics, related }
}

/** 原行读取在调用者事务内完成；查询不按当前班组或确认状态裁掉日内事实。 */
export async function loadPayrollDayworkFacts(tx: TransactionDb, query: { projectId: string, month: string }): Promise<PayrollDayworkFacts> {
  if (!query.projectId || !isISODateDTO(`${query.month}-01`))
    throw payrollProblem('validation-failed', '签工项目与月份无效')
  const raw = (await tx.select<PayrollJsonObject>('SELECT * FROM signed_daywork_records WHERE project_id=? ORDER BY id', [query.projectId])).filter(row => !isISODateDTO(row.work_date) || row.work_date.slice(0, 7) === query.month)
  const rows = raw.map(daywork)
  const saved = await sourceEvidence(tx, query.projectId, 'signed_daywork_records', row => !isISODateDTO(row.work_date) || row.work_date.slice(0, 7) === query.month)
  const used = await occupationFacts(tx, rows)
  const diagnostics = [...await dayworkDiagnostics(tx, raw), ...saved.diagnostics, ...used.diagnostics]
  return { sourceVersion: `payroll-daywork:${hash([query, raw, diagnostics, saved.evidence, used.occupations, used.related])}`, rows, occupations: used.occupations, diagnostics, evidence: saved.evidence }
}

/** 单条原 ID 决定编辑旧范围；坏日期与软删不转为新建表单。 */
export async function loadPayrollDayworkRecord(tx: TransactionDb, recordId: string): Promise<PayrollDayworkRecordFacts> {
  if (!recordId)
    throw payrollProblem('validation-failed', '原签工身份无效')
  const raw = await tx.select<PayrollJsonObject>('SELECT * FROM signed_daywork_records WHERE id=?', [recordId])
  const record = raw[0] ? daywork(raw[0]) : null
  const saved = await sourceEvidence(tx, record?.projectId ?? null, 'signed_daywork_records', (row, mappings) => row.id === recordId || mappings.some(mapping => mapping.tableName === 'signed_daywork_records' && mapping.legacyId === row.id && mapping.centralId === recordId))
  const used = await occupationFacts(tx, record ? [record] : [])
  const diagnostics = [...await dayworkDiagnostics(tx, raw), ...saved.diagnostics, ...used.diagnostics]
  return { sourceVersion: `payroll-daywork-record:${hash([recordId, raw, diagnostics, saved.evidence, used.occupations, used.related])}`, record, occupations: used.occupations, diagnostics, evidence: saved.evidence }
}

/** 项目×负责人配置不按月份生效；停用、软删与非法原值都保留。 */
export async function loadPayrollC2ConfigFacts(tx: TransactionDb, scope: PayrollC2ConfigScope): Promise<PayrollC2ConfigFacts> {
  if (!scope.projectId || !scope.leaderWorkerId)
    throw payrollProblem('validation-failed', 'C2 配置原范围无效')
  const raw = await tx.select<PayrollJsonObject>('SELECT * FROM payroll_subject_configs WHERE project_id=? AND leader_worker_id=? ORDER BY id', [scope.projectId, scope.leaderWorkerId])
  const diagnostics = await subjectDiagnostics(tx, raw, 'payroll_subject_configs')
  const rows: PayrollC2ConfigFact[] = raw.map((row) => {
    const unitRate = finite(row.unit_rate)
    const add = (code: string, message: string, field: string) => diagnostics.push(diagnostic(row, 'payroll_subject_configs', code, message, field))
    if (unitRate === null || unitRate <= 0)
      add('c2-rate-invalid', '原 C2 大工单价缺失或不是正数；明确零保留为零', 'unit_rate')
    if (row.format_family !== 'C2')
      add('c2-config-format-invalid', '原配置格式不是 C2', 'format_family')
    if (typeof row.rule_text !== 'string')
      add('c2-rule-invalid', '原规则正文缺失；不补当前默认文字', 'rule_text')
    if (row.enabled !== 0 && row.enabled !== 1)
      add('c2-config-enabled-invalid', '原配置启用状态无法确认', 'enabled')
    return { id: text(row.id) ?? '', projectId: text(row.project_id) ?? '', crewId: text(row.crew_id), leaderWorkerId: text(row.leader_worker_id) ?? '', formatFamily: text(row.format_family), unitRate, ruleText: text(row.rule_text), enabled: row.enabled === 1 ? true : row.enabled === 0 ? false : null, createdAt: text(row.created_at), updatedAt: text(row.updated_at), deletedAt: text(row.deleted_at), sourceFingerprint: hash(row), original: row }
  })
  const active = raw.filter(row => row.deleted_at === null && row.format_family === 'C2')
  if (active.length > 1)
    diagnostics.push(...active.map(row => diagnostic(row, 'payroll_subject_configs', 'c2-config-duplicate', '同一项目负责人存在多个有效 C2 原配置，不能猜选价格')))
  const saved = await sourceEvidence(tx, scope.projectId, 'payroll_subject_configs', (row, mappings) => row.leader_worker_id === scope.leaderWorkerId || mappings.some(mapping => mapping.tableName === 'workers' && mapping.legacyId === row.leader_worker_id && mapping.centralId === scope.leaderWorkerId))
  diagnostics.push(...saved.diagnostics)
  return { sourceVersion: `payroll-c2-config:${hash([scope, raw, diagnostics, saved.evidence])}`, rows, diagnostics, evidence: saved.evidence }
}
