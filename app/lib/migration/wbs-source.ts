import type { SoftDb } from '../db/soft-delete'
import type { QuantityMigrationRow } from '../quantity/migration-graph'
import type { CoreMigrationSourceEntityDTO } from './core-contract'
import { isISODateDTO } from '../../types/read-model'
import { quantityProblem } from '../quantity/central-contract'
import { quantityMigrationTimestamp } from '../quantity/migration-graph'

const identity = ['id', 'created_at', 'updated_at', 'deleted_at'] as const
/** 固定物理字段白名单；保留软删、无分组任务和原始快照，不查询可见性视图。 */
export const WBS_MIGRATION_COLUMNS = {
  schedule_groups: [...identity, 'project_id', 'name', 'sort_order', 'contract_id', 'scope_basis', 'contract_bound_at', 'process_library_id', 'process_library_name_snapshot', 'process_library_version_snapshot'],
  schedule_group_buildings: [...identity, 'group_id', 'building_id', 'sort_order'],
  schedule_tasks: [...identity, 'project_id', 'group_id', 'parent_id', 'name', 'trade', 'color', 'duration_days', 'planned_start', 'planned_finish', 'baseline_start', 'baseline_finish', 'has_qty', 'manual_progress', 'stage_id', 'sort_order', 'source_library_task_id', 'source_library_version', 'template_snapshot_json'],
  task_item_map: [...identity, 'task_id', 'item_id', 'boq_line_id'],
  task_dependencies: [...identity, 'pred_id', 'succ_id', 'dependency_type', 'lag_days'],
  schedule_task_floor_plans: [...identity, 'task_id', 'floor_id', 'item_id', 'boq_line_id', 'source_basis', 'provisional_qty', 'planned_start', 'planned_finish', 'is_manual', 'note', 'sort_order'],
  operation_logs: ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at'],
} as const
export type WbsMigrationTable = keyof typeof WBS_MIGRATION_COLUMNS
export const WBS_MIGRATION_TABLES = Object.keys(WBS_MIGRATION_COLUMNS) as WbsMigrationTable[]
export interface WbsMigrationGraph {
  version: 1
  projectId: string
  tables: Record<WbsMigrationTable, QuantityMigrationRow[]>
}
function emptyTables(): WbsMigrationGraph['tables'] {
  return { schedule_groups: [], schedule_group_buildings: [], schedule_tasks: [], task_item_map: [], task_dependencies: [], schedule_task_floor_plans: [], operation_logs: [] }
}
export function wbsMigrationInvalid(message: string): never {
  throw quantityProblem('relationship-mismatch', `WBS 迁移：${message}`)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function parseWbsSnapshot(value: unknown, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : null
  }
  catch { wbsMigrationInvalid(`${label}不是有效 JSON`) }
  if (!object(parsed))
    wbsMigrationInvalid(`${label}必须为对象`)
  return parsed
}
const numbers = new Set(['sort_order', 'duration_days', 'has_qty', 'manual_progress', 'lag_days', 'is_manual', 'provisional_qty', 'process_library_version_snapshot', 'source_library_version'])
function rows(value: unknown, table: WbsMigrationTable): QuantityMigrationRow[] {
  if (!Array.isArray(value))
    wbsMigrationInvalid(`${table}未完整提供`)
  const columns: readonly string[] = WBS_MIGRATION_COLUMNS[table]
  const ids = new Set<string>()
  return value.map((input) => {
    if (!object(input) || columns.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !columns.includes(key)))
      wbsMigrationInvalid(`${table}字段缺失或未知`)
    const row: QuantityMigrationRow = {}
    for (const [key, entry] of Object.entries(input)) {
      if (entry !== null && (numbers.has(key) ? typeof entry !== 'number' || !Number.isFinite(entry) : typeof entry !== 'string'))
        wbsMigrationInvalid(`${table}.${key}字段类型无效`)
      row[key] = ['created_at', 'updated_at', 'deleted_at', 'contract_bound_at'].includes(key)
        ? quantityMigrationTimestamp(entry, `${table}.${key}`)
        : entry as string | number | null
      if (['created_at', 'updated_at'].includes(key) && entry === null)
        wbsMigrationInvalid(`${table}创建/更新时间缺失`)
    }
    if (typeof row.id !== 'string' || !row.id.trim() || row.id !== row.id.trim() || ids.has(row.id))
      wbsMigrationInvalid(`${table}身份无效或重复`)
    ids.add(row.id)
    if (Object.hasOwn(row, 'sort_order') && !Number.isSafeInteger(row.sort_order))
      wbsMigrationInvalid(`${table}排序无效`)
    return row
  })
}
/** 先证明物理内部拓扑；外部量域/库/合同身份由同批中央候选映射验证。 */
export function parseWbsMigrationGraph(value: unknown, projectId?: string): WbsMigrationGraph {
  if (!object(value) || value.version !== 1 || typeof value.projectId !== 'string' || !value.projectId.trim()
    || (projectId && value.projectId !== projectId) || !object(value.tables)
    || Object.keys(value).some(key => !['version', 'projectId', 'tables'].includes(key))
    || Object.keys(value.tables).some(key => !WBS_MIGRATION_TABLES.includes(key as WbsMigrationTable))) {
    wbsMigrationInvalid('项目或完整图结构无效')
  }
  const tables = Object.fromEntries(WBS_MIGRATION_TABLES.map(table => [table, rows(value.tables && (value.tables as Record<string, unknown>)[table], table)])) as WbsMigrationGraph['tables']
  const graph: WbsMigrationGraph = { version: 1, projectId: value.projectId, tables }
  const maps = Object.fromEntries(WBS_MIGRATION_TABLES.map(table => [table, new Map(tables[table].map(row => [row.id, row]))])) as Record<WbsMigrationTable, Map<unknown, QuantityMigrationRow>>
  function parent(table: WbsMigrationTable, id: unknown) {
    const row = maps[table].get(id)
    if (!row)
      wbsMigrationInvalid(`${table}缺少明确父身份 ${String(id)}`)
    return row
  }
  function dates(row: QuantityMigrationRow, start = 'planned_start', finish = 'planned_finish') {
    if (!isISODateDTO(row[start]) || !isISODateDTO(row[finish]) || String(row[start]) > String(row[finish]))
      wbsMigrationInvalid('计划或基线日期无效')
  }
  for (const group of tables.schedule_groups) {
    if (group.project_id !== graph.projectId || !String(group.name ?? '').trim()
      || (group.scope_basis !== null && !['contract', 'provisional'].includes(String(group.scope_basis)))
      || (group.scope_basis !== null && (group.scope_basis === 'contract') !== (group.contract_id !== null))
      || (group.contract_bound_at !== null && group.contract_id === null)) {
      wbsMigrationInvalid('分组项目、名称或既有绑定状态无效')
    }
    if ((group.process_library_id === null) !== (group.process_library_version_snapshot === null))
      wbsMigrationInvalid('分组库版本身份不完整')
  }
  for (const row of tables.schedule_group_buildings)
    parent('schedule_groups', row.group_id)
  for (const task of tables.schedule_tasks) {
    if (task.project_id !== graph.projectId || !String(task.name ?? '').trim() || !Number.isSafeInteger(task.duration_days) || Number(task.duration_days) < 1)
      wbsMigrationInvalid('任务项目、名称或工期无效')
    if (task.group_id !== null)
      parent('schedule_groups', task.group_id)
    dates(task)
    if (task.baseline_start !== null || task.baseline_finish !== null)
      dates(task, 'baseline_start', 'baseline_finish')
    if (!(task.has_qty === 1 && task.stage_id !== null && task.manual_progress === null)
      && !(task.has_qty === 0 && task.stage_id === null && typeof task.manual_progress === 'number' && task.manual_progress >= 0 && task.manual_progress <= 1)) {
      wbsMigrationInvalid('任务自动/手工进度模式无效')
    }
    const visited = new Set([task.id])
    let cursor = task.parent_id
    while (cursor !== null) {
      const ancestor = parent('schedule_tasks', cursor)
      if (visited.has(cursor) || ancestor.group_id !== task.group_id)
        wbsMigrationInvalid('任务父级循环或跨组')
      visited.add(cursor)
      cursor = ancestor.parent_id
    }
    if (task.template_snapshot_json !== null)
      parseWbsSnapshot(task.template_snapshot_json, '工序冻结快照')
  }
  for (const row of tables.task_item_map)
    parent('schedule_tasks', row.task_id)
  const active = new Map<unknown, unknown>()
  for (const row of tables.task_dependencies) {
    const pred = parent('schedule_tasks', row.pred_id)
    const succ = parent('schedule_tasks', row.succ_id)
    if (row.pred_id === row.succ_id || pred.group_id !== succ.group_id || row.dependency_type !== 'FS' || !Number.isSafeInteger(row.lag_days))
      wbsMigrationInvalid('依赖身份、同组 FS 类型或 lag 无效')
    if (row.deleted_at === null && pred.deleted_at === null && succ.deleted_at === null) {
      if (active.has(row.succ_id))
        wbsMigrationInvalid('后续任务有多个活跃前置')
      active.set(row.succ_id, row.pred_id)
    }
  }
  for (const [id, pred] of active) {
    const visited = new Set([id])
    let cursor: unknown = pred
    while (cursor !== undefined) {
      if (visited.has(cursor))
        wbsMigrationInvalid('活跃依赖循环')
      visited.add(cursor)
      cursor = active.get(cursor)
    }
  }
  for (const row of tables.schedule_task_floor_plans) {
    parent('schedule_tasks', row.task_id)
    dates(row)
    if (![0, 1].includes(Number(row.is_manual))
      || (!(row.source_basis === 'contract' && row.boq_line_id !== null && row.provisional_qty === null)
        && !(row.source_basis === 'provisional' && row.boq_line_id === null && (row.provisional_qty === null || (typeof row.provisional_qty === 'number' && row.provisional_qty >= 0))))) {
      wbsMigrationInvalid('楼层计划的人工标记或冻结数量来源无效')
    }
  }
  for (const row of tables.operation_logs) {
    const table = row.table_name as WbsMigrationTable
    if (!WBS_MIGRATION_TABLES.includes(table) || table === 'operation_logs')
      wbsMigrationInvalid('审计表不属于 WBS')
    parent(table, row.record_id)
    if (!['create', 'update', 'delete', 'restore'].includes(String(row.action)))
      wbsMigrationInvalid('审计动作无效')
    for (const key of ['before_data', 'after_data']) {
      if (row[key] !== null) {
        const snapshot = parseWbsSnapshot(row[key], '审计快照')
        if (snapshot.id !== row.record_id || Object.keys(snapshot).some(field => !(WBS_MIGRATION_COLUMNS[table] as readonly string[]).includes(field)))
          wbsMigrationInvalid('审计快照身份或字段无效')
      }
    }
  }
  return graph
}

export async function readWbsMigrationGraphs(db: Pick<SoftDb, 'select'>): Promise<CoreMigrationSourceEntityDTO[]> {
  const projects = await db.select<{ id: string, name: string, deleted_at: string | null }>('SELECT id, name, deleted_at FROM projects ORDER BY id')
  const byProject = new Map(projects.map(project => [project.id, { project, graph: { version: 1 as const, projectId: project.id, tables: emptyTables() } }]))
  const owners = new Map<string, string>()
  const ownerKey = (table: string, id: unknown) => JSON.stringify([table, id])
  for (const table of WBS_MIGRATION_TABLES) {
    const where = table === 'operation_logs' ? ` WHERE table_name IN (${WBS_MIGRATION_TABLES.filter(name => name !== 'operation_logs').map(name => `'${name}'`).join(', ')})` : ''
    const values = await db.select<QuantityMigrationRow>(`SELECT ${WBS_MIGRATION_COLUMNS[table].join(', ')} FROM ${table}${where} ORDER BY id`)
    for (const row of values) {
      const projectId = table === 'schedule_groups' || table === 'schedule_tasks'
        ? String(row.project_id)
        : table === 'schedule_group_buildings'
          ? owners.get(ownerKey('schedule_groups', row.group_id))
          : table === 'task_dependencies'
            ? owners.get(ownerKey('schedule_tasks', row.pred_id))
            : table === 'operation_logs'
              ? owners.get(ownerKey(String(row.table_name), row.record_id))
              : owners.get(ownerKey('schedule_tasks', row.task_id))
      const source = projectId ? byProject.get(projectId) : undefined
      if (!source)
        wbsMigrationInvalid(`${table}/${String(row.id)}缺少明确项目祖先`)
      source.graph.tables[table].push(row)
      owners.set(ownerKey(table, row.id), source.project.id)
    }
  }
  return [...byProject.values()].filter(({ graph }) => WBS_MIGRATION_TABLES.some(table => graph.tables[table].length)).map(({ project, graph }) => ({
    legacyId: project.id,
    name: project.name,
    deletedAt: quantityMigrationTimestamp(project.deleted_at, 'WBS 项目删除'),
    references: { projectId: project.id },
    attributes: { graphJson: JSON.stringify(parseWbsMigrationGraph(graph, project.id)) },
  }))
}
