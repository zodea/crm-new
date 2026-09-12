import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { PayrollMigrationPart, PayrollMigrationRow, PayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import type { PayrollDiagnostic, PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import type { QuantityMigrationIdentity } from '../../app/lib/quantity/migration-mapping'
import { createHash } from 'node:crypto'
import { parsePayrollProjectGraph, PAYROLL_MIGRATION_COLUMNS, PAYROLL_MIGRATION_PARTS, PAYROLL_MIGRATION_TABLES, payrollLogProject, payrollLogSnapshot } from '../../app/lib/migration/payroll-source'
import { advancePayrollRevision, initializePayrollSchema } from '../../app/lib/payroll/central-schema'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'

export interface ImportedPayrollProject {
  entityId: string
  projectId: string
  batchId: string
  fingerprint: string
  source: PayrollProjectGraph
  graph: PayrollProjectGraph
  mappings: PayrollIdentityMapping[]
  diagnostics: PayrollDiagnostic[]
}
const parts = PAYROLL_MIGRATION_PARTS.filter(part => part !== 'logs')
const references = { project_id: 'projects', crew_id: 'crews', worker_id: 'workers', leader_worker_id: 'workers', statement_id: 'wage_statements', subject_config_id: 'payroll_subject_configs', daywork_record_id: 'signed_daywork_records', item_id: 'items' } as const
const optionalReferences = new Set(['crew_id', 'subject_config_id', 'item_id'])
const numericFields = new Set(['unit_rate', 'enabled', 'needs_recheck', 'pay_ratio', 'cumulative_amount', 'previously_paid', 'gross_amount', 'actual_amount', 'quantity', 'unit_price', 'amount', 'sort_order', 'is_leader', 'allocated_amount_fen', 'hours', 'overtime_hours', 'labor_units'])
const nullableFields = new Set(['crew_id', 'subject_config_id', 'item_id', 'actual_amount', 'source_updated_at', 'snapshot_json', 'checked_at', 'submitted_at', 'released_at', 'deleted_at', 'confirmed_on'])
function invalid(message: string): never {
  throw new ProjectRepositoryProblem(projectProblem('conflict', `工资迁移：${message}`))
}
function key(table: string, id: unknown) {
  return JSON.stringify([table, id])
}
function rowProblem(part: PayrollMigrationPart, row: PayrollMigrationRow): string | null {
  if (PAYROLL_MIGRATION_COLUMNS[part].some(field => row[field] === null ? !nullableFields.has(field) : numericFields.has(field) ? typeof row[field] !== 'number' : typeof row[field] !== 'string'))
    return '原表字段类型或非空约束不符'
  if (part === 'configs' && (row.format_family !== 'C2' || Number(row.unit_rate) <= 0 || ![0, 1].includes(Number(row.enabled))))
    return '主体配置格式、费率或启用值无效'
  if (part === 'statements' && (!['A', 'B', 'C1', 'C2'].includes(String(row.format_family)) || !['monthly', 'settlement', 'retention'].includes(String(row.period_kind)) || !['advance', 'final'].includes(String(row.purpose)) || !['provisional', 'field'].includes(String(row.quantity_source)) || !['draft', 'checked', 'released'].includes(String(row.status)) || ![0, 1].includes(Number(row.needs_recheck)) || Number(row.pay_ratio) < 0 || Number(row.pay_ratio) > 1))
    return '工资状态、格式或比例不符原表约束'
  if (part === 'members' && ![0, 1].includes(Number(row.is_leader)))
    return '负责人标记无效'
  if (part === 'allocations' && (!Number.isSafeInteger(row.allocated_amount_fen) || Number(row.allocated_amount_fen) < 0))
    return '实际分配不是有效非负整数分'
  if (part === 'attendance' && (Number(row.hours) < 0 || Number(row.overtime_hours) < 0 || Number(row.hours) + Number(row.overtime_hours) > 24))
    return '考勤工时违反原表约束'
  if (part === 'daywork' && (![0.5, 1].includes(Number(row.labor_units)) || !['draft', 'confirmed'].includes(String(row.status))))
    return '签工工数或状态违反原表约束'
  return null
}

/** 原图保留全文；仅对已证明的当前行关系建中央映射。不能从指纹反推 A/C1 旧来源。 */
export function planPayrollMigration(snapshot: CoreMigrationSnapshotDTO, current: ReadonlyMap<string, ImportedPayrollProject>, quantityIdentities: readonly (QuantityMigrationIdentity & { projectId: string })[] = []) {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'payroll_projects') : []
  const removed = [...current.values()].filter(row => row.batchId !== batchId || !entities.some(entity => entity.id === row.entityId))
  const imports = new Map([...current].filter(([, value]) => !removed.includes(value)))
  const incoming: ImportedPayrollProject[] = []
  const sources = entities.map((entity) => {
    let raw: unknown
    try {
      raw = JSON.parse(String(entity.attributes.payrollGraphJson))
    }
    catch { invalid('完整项目图不是有效 JSON') }
    return parsePayrollProjectGraph(raw, entity.legacyId)
  })
  const logIds = new Set<string>()
  for (const source of sources) {
    for (const log of source.logs) {
      if (typeof log.id !== 'string' || logIds.has(log.id) || payrollLogProject(log, sources) !== source.projectId)
        invalid('历史审计不属于本工资项目、无法证明归属或重复接管')
      logIds.add(log.id)
    }
  }
  for (const [index, entity] of entities.entries()) {
    const source = sources[index]!
    const project = snapshot.entities.find(row => row.entityType === 'projects' && row.id === entity.references.projectId && row.legacyId === source.projectId)
    if (!project || !batchId || entity.batchId !== batchId)
      invalid('工资项目缺少显式中央映射')
    const mapping = new Map<string, PayrollIdentityMapping>()
    for (const row of snapshot.entities.filter(row => ['projects', 'crews', 'workers'].includes(row.entityType)))
      mapping.set(key(row.entityType, row.legacyId), { tableName: row.entityType, legacyId: row.legacyId, centralId: row.id })
    for (const identity of quantityIdentities.filter(identity => identity.projectId === project.id))
      mapping.set(key(identity.table, identity.legacyId), { tableName: identity.table, legacyId: identity.legacyId, centralId: identity.id })
    for (const part of PAYROLL_MIGRATION_PARTS) {
      for (const row of source[part])
        mapping.set(key(PAYROLL_MIGRATION_TABLES[part], row.id), { tableName: PAYROLL_MIGRATION_TABLES[part], legacyId: String(row.id), centralId: `${entity.id}:${PAYROLL_MIGRATION_TABLES[part]}:${encodeURIComponent(String(row.id))}` })
    }
    const diagnostics: PayrollDiagnostic[] = []
    const diagnose = (code: string, message: string, part: PayrollMigrationPart, row: PayrollMigrationRow, field: string | null = null) => {
      if (!diagnostics.some(d => d.code === code && d.tableName === PAYROLL_MIGRATION_TABLES[part] && d.recordId === row.id && d.field === field))
        diagnostics.push({ code, message, tableName: PAYROLL_MIGRATION_TABLES[part], recordId: String(row.id), field })
    }
    const isolate = (part: PayrollMigrationPart, row: PayrollMigrationRow, code: string, message: string, field: string | null = null) => {
      mapping.get(key(PAYROLL_MIGRATION_TABLES[part], row.id))!.centralId = null
      diagnose(code, message, part, row, field)
    }
    const uniqueFields: Partial<Record<PayrollMigrationPart, string[]>> = {
      configs: ['project_id', 'leader_worker_id', 'format_family'],
      statements: ['project_id', 'leader_worker_id', 'month', 'format_family', 'period_kind'],
      members: ['statement_id', 'worker_id'],
      allocations: ['statement_id', 'worker_id'],
      attendance: ['project_id', 'worker_id', 'work_date'],
      daywork: ['project_id', 'worker_id', 'work_date', 'start_time', 'end_time'],
      statementDaywork: ['daywork_record_id'],
    }
    for (const part of parts) {
      for (const row of source[part]) {
        const problem = rowProblem(part, row)
        if (problem)
          isolate(part, row, 'row-invalid', `${problem}；原行保留在隔离报告`)
        const fields = uniqueFields[part]
        if (fields && row.deleted_at === null && source[part].some(other => other.id !== row.id && other.deleted_at === null && fields.every(field => other[field] === row[field])))
          isolate(part, row, 'duplicate-identity', '原来源违反当前唯一性；全部重复行保留隔离，不能任选一行')
      }
    }
    // 祖先隔离逐层传播，不能用伪造人员或空祖先满足外键。
    let changed = true
    while (changed) {
      changed = false
      for (const part of parts) {
        for (const row of source[part]) {
          if (mapping.get(key(PAYROLL_MIGRATION_TABLES[part], row.id))!.centralId === null)
            continue
          for (const [field, table] of Object.entries(references)) {
            if (!Object.hasOwn(row, field) || (row[field] === null && optionalReferences.has(field)))
              continue
            const related = mapping.get(key(table, row[field]))
            if (!related?.centralId) {
              if (!related)
                mapping.set(key(table, row[field]), { tableName: table, legacyId: String(row[field]), centralId: null })
              if (field === 'item_id') {
                mapping.set(key(table, row[field]), { tableName: table, legacyId: String(row[field]), centralId: null })
                diagnose('source-unproven', '旧分项身份没有可证明的工程量映射；保原值，不补造当前关系', part, row, field)
                continue
              }
              isolate(part, row, 'identity-unmapped', `${field} 缺少可证明的稳定身份；原行保留隔离`, field)
              changed = true
              break
            }
          }
          if (part === 'statements' && row.subject_config_id !== null && source.configs.find(config => config.id === row.subject_config_id)?.project_id !== source.projectId) {
            isolate(part, row, 'orphan-reference', '主体配置不属于本项目原图', 'subject_config_id')
            changed = true
          }
        }
      }
    }
    for (const row of source.statements) {
      if (row.format_family === 'B')
        diagnose('retired-b', '历史 B 类保留原状态与金额，仅供隔离核对；不能转为新工资来源', 'statements', row, 'format_family')
      if (row.format_family === 'A' || row.format_family === 'C1')
        diagnose('source-unproven', '旧工资未保存完成/责任或考勤行来源 ID；原值保留，不能按当前资料重建历史资格', 'statements', row, 'source_version')
      if (row.status === 'released') {
        if (row.format_family === 'C1' || row.format_family === 'C2') {
          const lockedWorkers = new Set([row.leader_worker_id, ...source.members.filter(member => member.statement_id === row.id).map(member => member.worker_id)])
          const opposite = row.format_family === 'C2' ? source.attendance : source.daywork
          if (opposite.some(record => lockedWorkers.has(record.worker_id) && String(record.work_date).slice(0, 7) === row.month && record.deleted_at === null))
            diagnose('source-conflict', '已发月份的负责人或成员（含零成员）存在另一种来源；保留双方原事实，待核对，不能视为空锁', 'statements', row)
        }
        const snapshotData = payrollLogSnapshot(row.snapshot_json)
        if (row.snapshot_json === null || row.snapshot_json === '')
          diagnose('snapshot-missing', '已发快照缺失；保留缺失，不使用当前资料补齐', 'statements', row, 'snapshot_json')
        else if (!snapshotData)
          diagnose('snapshot-invalid', '已发快照无法解析为对象；原文完整保留', 'statements', row, 'snapshot_json')
        if (row.actual_amount === null)
          diagnose('actual-missing', '历史实发金额缺失，不能按零解释', 'statements', row, 'actual_amount')
        const members = source.members.filter(member => member.statement_id === row.id && member.deleted_at === null)
        const allocations = source.allocations.filter(allocation => allocation.statement_id === row.id && allocation.deleted_at === null)
        if (!members.length || members.some(member => !allocations.some(allocation => allocation.worker_id === member.worker_id)) || allocations.some(allocation => !members.some(member => member.worker_id === allocation.worker_id)) || (row.actual_amount !== null && allocations.reduce((sum, allocation) => sum + Number(allocation.allocated_amount_fen), 0) !== Math.round(Number(row.actual_amount) * 100)))
          diagnose('allocation-mismatch', '历史实发与成员分配缺失或不一致；零成员也保留，不补造分配', 'statements', row)
      }
    }
    for (const attendance of source.attendance.filter(row => row.deleted_at === null)) {
      if (source.daywork.some(day => day.deleted_at === null && day.worker_id === attendance.worker_id && String(day.work_date).slice(0, 7) === String(attendance.work_date).slice(0, 7)))
        diagnose('source-conflict', '同人同月并存考勤与签工；原事实保留，不能自动选择一种', 'attendance', attendance)
    }
    const graph = { schemaVersion: 1, projectId: project.id } as PayrollProjectGraph
    for (const part of parts) {
      graph[part] = source[part].filter(row => mapping.get(key(PAYROLL_MIGRATION_TABLES[part], row.id))!.centralId !== null).map((row) => {
        const mapped: PayrollMigrationRow = { ...row, id: mapping.get(key(PAYROLL_MIGRATION_TABLES[part], row.id))!.centralId! }
        for (const [field, table] of Object.entries(references)) {
          if (Object.hasOwn(row, field) && row[field] !== null)
            mapped[field] = mapping.get(key(table, row[field]))?.centralId ?? null
        }
        return mapped
      })
    }
    graph.logs = source.logs.map(row => ({ ...row, id: mapping.get(key('operation_logs', row.id))!.centralId!, record_id: mapping.get(key(String(row.table_name), row.record_id))?.centralId ?? `payroll-report-record:${entity.id}:${String(row.table_name)}:${encodeURIComponent(String(row.record_id))}` }))
    const mappings = [...mapping.values()]
    const fingerprint = createHash('sha256').update(JSON.stringify([source, mappings])).digest('hex')
    const previous = imports.get(entity.id)
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        invalid('同批次来源或映射变化，不能覆盖日常事实')
      continue
    }
    incoming.push({ entityId: entity.id, projectId: project.id, batchId, fingerprint, source, graph, mappings, diagnostics })
  }
  return { incoming, removed, imports, references: snapshot.entities }
}

function graphFingerprint(graph: PayrollProjectGraph) {
  return JSON.stringify(PAYROLL_MIGRATION_PARTS.map(part => graph[part].toSorted((a, b) => String(a.id).localeCompare(String(b.id))).map(row => PAYROLL_MIGRATION_COLUMNS[part].map(field => row[field]))))
}
export interface PayrollRemovedIdentities { projects: ReadonlySet<string>, crews: ReadonlySet<string>, workers: ReadonlySet<string>, quantity: readonly QuantityMigrationIdentity[] }

/** 所有删除之前检查；历史软删、零成员及孤立来源仍构成独立引用。 */
export async function assertPayrollMigrationRemoval(db: TransactionDb, plan: ReturnType<typeof planPayrollMigration>, removed: PayrollRemovedIdentities) {
  await initializePayrollSchema(db)
  const all = Object.fromEntries(await Promise.all(PAYROLL_MIGRATION_PARTS.map(async part => [part, await db.select<PayrollMigrationRow>(`SELECT ${PAYROLL_MIGRATION_COLUMNS[part].join(',')} FROM ${PAYROLL_MIGRATION_TABLES[part]}`)]))) as Record<PayrollMigrationPart, PayrollMigrationRow[]>
  const owned = new Set(plan.removed.flatMap(previous => PAYROLL_MIGRATION_PARTS.flatMap(part => previous.graph[part].map(row => key(PAYROLL_MIGRATION_TABLES[part], row.id)))))
  const removedKeys = new Set([...owned, ...['projects', 'crews', 'workers'].flatMap(table => [...removed[table as 'projects' | 'crews' | 'workers']].map(id => key(table, id))), ...removed.quantity.map(identity => key(identity.table, identity.id))])
  for (const previous of plan.removed) {
    const actual = { schemaVersion: 1, projectId: previous.projectId } as PayrollProjectGraph
    for (const part of PAYROLL_MIGRATION_PARTS)
      actual[part] = all[part].filter(row => previous.graph[part].some(old => old.id === row.id))
    const evidence = await db.select<{ source_graph_json: string, mapping_json: string, diagnostics_json: string }>('SELECT * FROM payroll_migration_evidence WHERE entity_id = ?', [previous.entityId])
    if (graphFingerprint(actual) !== graphFingerprint(previous.graph) || evidence.length !== 1 || evidence[0]!.source_graph_json !== JSON.stringify(previous.source) || evidence[0]!.mapping_json !== JSON.stringify(previous.mappings) || evidence[0]!.diagnostics_json !== JSON.stringify(previous.diagnostics))
      invalid('迁入后工资或来源已有日常变更；恢复会丢失当前事实，已整批拒绝')
  }
  for (const part of parts) {
    for (const row of all[part]) {
      if (owned.has(key(PAYROLL_MIGRATION_TABLES[part], row.id)))
        continue
      if (Object.entries(references).some(([field, table]) => removedKeys.has(key(table, row[field]))))
        invalid(`独立 ${PAYROLL_MIGRATION_TABLES[part]} 仍引用待撤身份，软删除不解除历史关系`)
    }
  }
  const logs = await db.select<PayrollMigrationRow>('SELECT * FROM operation_logs')
  for (const log of logs.filter(row => !owned.has(key('operation_logs', row.id)))) {
    const payrollTable = parts.some(part => PAYROLL_MIGRATION_TABLES[part] === log.table_name)
    if (payrollTable && removedKeys.has(key(String(log.table_name), log.record_id)))
      invalid('独立审计仍引用待撤工资或来源身份')
    for (const data of [log.before_data, log.after_data].map(payrollLogSnapshot)) {
      // 其他域的项目/工程量审计由其迁移 owner 校验；工资只拦跨域明确指向工资的关系。
      if (data && Object.entries(references).some(([field, table]) => (payrollTable || ['statement_id', 'subject_config_id', 'daywork_record_id'].includes(field)) && removedKeys.has(key(table, data[field]))))
        invalid('独立历史仍引用待撤项目、人员或工资来源')
    }
  }
}

export async function applyPayrollMigration(db: TransactionDb, plan: ReturnType<typeof planPayrollMigration>) {
  for (const previous of plan.removed) {
    for (const part of [...PAYROLL_MIGRATION_PARTS].reverse()) {
      for (const row of previous.graph[part])
        await db.execute(`DELETE FROM ${PAYROLL_MIGRATION_TABLES[part]} WHERE id = ?`, [row.id])
    }
    await db.execute('DELETE FROM payroll_migration_evidence WHERE entity_id = ?', [previous.entityId])
  }
  for (const next of plan.incoming) {
    for (const type of ['projects', 'crews', 'workers'] as const) {
      for (const row of plan.references.filter(row => row.entityType === type))
        await db.execute(`INSERT INTO ${type}(id,name,deleted_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`, [row.id, row.name, row.deletedAt])
    }
    // prepare 使用同一候选事务并延迟外键；正文顺序不产生额外队列。
    for (const part of PAYROLL_MIGRATION_PARTS) {
      const columns = PAYROLL_MIGRATION_COLUMNS[part]
      for (const row of next.graph[part])
        await db.execute(`INSERT INTO ${PAYROLL_MIGRATION_TABLES[part]} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
    }
    await db.execute('INSERT INTO payroll_migration_evidence(entity_id,project_id,batch_id,source_graph_json,diagnostics_json,mapping_json) VALUES (?,?,?,?,?,?)', [next.entityId, next.projectId, next.batchId, JSON.stringify(next.source), JSON.stringify(next.diagnostics), JSON.stringify(next.mappings)])
    plan.imports.set(next.entityId, next)
  }
  if (plan.incoming.length || plan.removed.length)
    await advancePayrollRevision(db)
}
