import type { SoftDb } from '../db/soft-delete'
import type { QuantityMigrationGraph, QuantityMigrationRow, QuantityMigrationTable, QuantityMigrationValue } from './migration-graph'
import { quantityProblem } from './central-contract'
import { buildQuantityHollowMigrationGraphs } from './hollow-migration-source'
import { readQuantityHollowTables } from './hollow-migration-tables'
import { parseQuantityMigrationGraph, QUANTITY_MIGRATION_COLUMNS, QUANTITY_MIGRATION_PROJECT_PARENTS, QUANTITY_MIGRATION_TABLES, quantityMigrationRowId, quantityMigrationTimestamp } from './migration-graph'

interface Project { id: string, name: string, matrix_archived_at: string | null, deleted_at: string | null }
export interface QuantityMigrationProjectSource { project: Project, graph: QuantityMigrationGraph }

function invalid(table: string, id: string): never {
  throw quantityProblem('relationship-mismatch', `工程量迁移无法确定 ${table} / ${id} 的显式项目祖先，请先核对原记录`)
}

function normalize(table: QuantityMigrationTable, row: QuantityMigrationRow): QuantityMigrationRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, ['created_at', 'updated_at', 'uploaded_at', 'deleted_at'].includes(key)
    ? quantityMigrationTimestamp(value, `${table}.${key}`)
    : value]))
}

/** 仅供受保护 SQLite 快照适配器使用；按物理身份读取，不因祖先软删丢历史。 */
export async function readQuantityMigrationGraphs(db: Pick<SoftDb, 'select'>, options: { captureUnknownColumns?: boolean } = {}): Promise<QuantityMigrationProjectSource[]> {
  const projects = await db.select<Project>('SELECT id, name, matrix_archived_at, deleted_at FROM projects ORDER BY id')
  const hollowTables = await readQuantityHollowTables(db, options)
  const hollow = hollowTables ? await buildQuantityHollowMigrationGraphs(db, hollowTables, projects.map(project => project.id)) : null
  const rows = {} as Record<QuantityMigrationTable, QuantityMigrationRow[]>
  for (const table of QUANTITY_MIGRATION_TABLES) {
    const where = table === 'file_refs'
      ? ' WHERE owner_type = \'unit_stage_completion\''
      : table === 'file_payloads' ? ' WHERE file_ref_id IN (SELECT id FROM file_refs WHERE owner_type = \'unit_stage_completion\')' : ''
    const primaryKey = table === 'file_payloads' ? 'file_ref_id' : 'id'
    rows[table] = (await db.select<QuantityMigrationRow>(`SELECT ${QUANTITY_MIGRATION_COLUMNS[table].join(', ')} FROM ${table}${where} ORDER BY ${primaryKey}`)).map(row => normalize(table, row))
  }
  const byProject = new Map(projects.map(project => [project.id, {
    project,
    graph: { version: 1 as const, projectId: project.id, archivedAt: quantityMigrationTimestamp(project.matrix_archived_at, '归档'), boqReferences: [] as QuantityMigrationGraph['boqReferences'], tables: Object.fromEntries(QUANTITY_MIGRATION_TABLES.map(table => [table, []])) as unknown as QuantityMigrationGraph['tables'] },
  }]))
  const boqReferences = await db.select<{ id: string, project_id: string, contract_id: string, deleted_at: string | null }>('SELECT id, project_id, contract_id, deleted_at FROM boq_lines ORDER BY id')
  for (const reference of boqReferences) {
    const source = byProject.get(reference.project_id)
    if (!source)
      invalid('BOQ历史引用', reference.id)
    source.graph.boqReferences.push({ id: reference.id, projectId: reference.project_id, contractId: reference.contract_id, deletedAt: quantityMigrationTimestamp(reference.deleted_at, 'BOQ历史引用删除') })
  }
  const projectFor = new Map<string, string>()
  function key(table: string, id: QuantityMigrationValue | undefined) {
    return JSON.stringify([table, id])
  }
  function owner(table: string, id: QuantityMigrationValue | undefined) {
    return projectFor.get(key(table, id))
  }
  function collect(table: QuantityMigrationTable, row: QuantityMigrationRow, projectId: string | undefined) {
    const source = projectId ? byProject.get(projectId) : null
    if (!source)
      return invalid(table, quantityMigrationRowId(table, row))
    source.graph.tables[table].push(row)
    projectFor.set(key(table, quantityMigrationRowId(table, row)), source.project.id)
  }
  for (const table of ['buildings', 'house_type_templates', 'items', 'construction_stages'] as const) {
    for (const row of rows[table])
      collect(table, row, typeof row.project_id === 'string' ? row.project_id : undefined)
  }
  for (const [tableName, [parent, foreignKey]] of Object.entries(QUANTITY_MIGRATION_PROJECT_PARENTS)) {
    const table = tableName as keyof typeof QUANTITY_MIGRATION_PROJECT_PARENTS
    if (parent === 'projects' || table === 'file_payloads')
      continue
    for (const row of rows[table])
      collect(table, row, owner(parent, row[foreignKey]))
  }
  const fileIds = new Set(rows.file_refs.map(row => row.id))
  for (const row of rows.file_payloads) {
    if (fileIds.has(row.file_ref_id))
      collect('file_payloads', row, owner('file_refs', row.file_ref_id))
  }
  for (const row of rows.operation_logs) {
    if (row.table_name === 'projects') {
      let before: Record<string, unknown> | null = null
      let after: Record<string, unknown> | null = null
      try {
        before = typeof row.before_data === 'string' ? JSON.parse(row.before_data) : null
        after = typeof row.after_data === 'string' ? JSON.parse(row.after_data) : null
      }
      catch { invalid('项目归档审计', String(row.id)) }
      if ((before?.matrix_archived_at ?? null) === (after?.matrix_archived_at ?? null))
        continue
      const archiveSnapshot = (value: Record<string, unknown> | null) => value === null ? null : JSON.stringify({ id: value.id, matrix_archived_at: value.matrix_archived_at ?? null })
      collect('operation_logs', { ...row, before_data: archiveSnapshot(before), after_data: archiveSnapshot(after) }, String(row.record_id))
    }
    else if (QUANTITY_MIGRATION_TABLES.includes(row.table_name as QuantityMigrationTable) && row.table_name !== 'operation_logs' && row.table_name !== 'file_payloads') {
      const projectId = owner(String(row.table_name), row.record_id)
      // file_refs 属多态共享表，其他业务附件审计不进入本迁移切片。
      if (row.table_name === 'file_refs' && !fileIds.has(row.record_id))
        continue
      collect('operation_logs', row, projectId)
    }
  }
  return [...byProject.values()]
    .filter(source => source.graph.archivedAt !== null || QUANTITY_MIGRATION_TABLES.some(table => source.graph.tables[table].length) || hollow?.get(source.project.id)?.tables.quantity_hollow_records.length)
    .map(source => ({ project: source.project, graph: parseQuantityMigrationGraph(hollow ? { ...source.graph, version: 2, hollow: hollow.get(source.project.id) } : source.graph, source.project.id) }))
}
