import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { quantityProblem } from './central-contract'
import { validateQuantityPhoto } from './central-photo'

export type QuantityMigrationValue = string | number | null
export type QuantityMigrationRow = Record<string, QuantityMigrationValue>
const identity = ['id', 'created_at', 'updated_at', 'deleted_at'] as const
const ordered = [...identity, 'code', 'name', 'sort_order'] as const

/** 仅列出本领域实际持有的列；迁移不接收任意 SQL 表、列或查询。 */
export const QUANTITY_MIGRATION_COLUMNS = {
  buildings: [...ordered, 'project_id'],
  house_type_templates: [...ordered, 'project_id', 'copied_from_template_id'],
  items: [...ordered, 'project_id', 'section', 'trade', 'unit'],
  construction_stages: [...ordered, 'project_id', 'trade', 'completion_mode'],
  floors: [...ordered, 'building_id'],
  rooms: [...ordered, 'template_id', 'kind'],
  units: [...ordered, 'floor_id', 'house_type_template_id'],
  house_type_template_items: [...identity, 'room_id', 'item_id', 'boq_line_id', 'recognized_contract_qty', 'contract_qty', 'provisional_qty', 'field_formula', 'field_qty', 'note', 'sort_order'],
  construction_stage_items: [...identity, 'stage_id', 'item_id', 'is_reporting_stage'],
  unit_assignments: [...identity, 'unit_id', 'trade', 'crew_id', 'worker_id', 'note'],
  unit_assignment_scopes: [...identity, 'assignment_id', 'room_id', 'item_id'],
  unit_stage_completions: [...identity, 'unit_id', 'stage_id', 'assignment_id', 'status', 'completed_at', 'note'],
  file_refs: ['id', 'owner_type', 'owner_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'category', 'uploader', 'uploaded_at', 'deleted_at'],
  file_payloads: ['file_ref_id', 'encoding', 'content'],
  operation_logs: ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at'],
} as const

export type QuantityMigrationTable = keyof typeof QUANTITY_MIGRATION_COLUMNS
export const QUANTITY_MIGRATION_PROJECT_PARENTS = {
  buildings: ['projects', 'project_id'],
  house_type_templates: ['projects', 'project_id'],
  items: ['projects', 'project_id'],
  construction_stages: ['projects', 'project_id'],
  floors: ['buildings', 'building_id'],
  rooms: ['house_type_templates', 'template_id'],
  units: ['floors', 'floor_id'],
  house_type_template_items: ['rooms', 'room_id'],
  construction_stage_items: ['construction_stages', 'stage_id'],
  unit_assignments: ['units', 'unit_id'],
  unit_assignment_scopes: ['unit_assignments', 'assignment_id'],
  unit_stage_completions: ['units', 'unit_id'],
  file_refs: ['unit_stage_completions', 'owner_id'],
  file_payloads: ['file_refs', 'file_ref_id'],
} as const
export const QUANTITY_MIGRATION_TABLES = Object.keys(QUANTITY_MIGRATION_COLUMNS) as QuantityMigrationTable[]
export interface QuantityMigrationBoqReference {
  id: string
  projectId: string
  contractId: string
  deletedAt: string | null
}
export interface QuantityMigrationGraph {
  version: 1
  projectId: string
  archivedAt: string | null
  boqReferences: QuantityMigrationBoqReference[]
  tables: Record<QuantityMigrationTable, QuantityMigrationRow[]>
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(message: string): never {
  throw quantityProblem('validation-failed', `工程量迁移：${message}`)
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}
export function quantityMigrationRowId(table: QuantityMigrationTable, row: QuantityMigrationRow): string {
  return String(row[table === 'file_payloads' ? 'file_ref_id' : 'id'])
}

export function quantityMigrationTimestamp(value: unknown, label: string): string | null {
  if (value === null)
    return null
  if (typeof value !== 'string' || !value)
    return invalid(`${label}时间格式无效`)
  const sqlite = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(value)
  if (!sqlite && !isISODateTimeDTO(value))
    return invalid(`${label}时间格式无效`)
  const normalized = sqlite ? `${value.replace(' ', 'T')}Z` : value
  if (!Number.isFinite(Date.parse(normalized)))
    return invalid(`${label}时间格式无效`)
  const timestamp = new Date(normalized).toISOString()
  if (!isISODateTimeDTO(timestamp) || (sqlite && timestamp.slice(0, 19) !== normalized.slice(0, 19)))
    return invalid(`${label}时间格式无效`)
  return timestamp
}

/** 结构和物理祖先验证同时覆盖软删行；当前不可见不等于可丢弃。 */
export function parseQuantityMigrationGraph(value: unknown, projectId?: string): QuantityMigrationGraph {
  if (!object(value) || value.version !== 1 || !identifier(value.projectId) || (projectId && value.projectId !== projectId)
    || !(value.archivedAt === null || isISODateTimeDTO(value.archivedAt)) || !object(value.tables)
    || !Array.isArray(value.boqReferences)
    || Object.keys(value).some(key => !['version', 'projectId', 'archivedAt', 'tables', 'boqReferences'].includes(key))
    || Object.keys(value.tables).some(key => !QUANTITY_MIGRATION_TABLES.includes(key as QuantityMigrationTable))) {
    invalid('项目、版本或表结构无效')
  }
  const boqIds = new Set<string>()
  const boqReferences = value.boqReferences.map((entry: unknown): QuantityMigrationBoqReference => {
    if (!object(entry) || !identifier(entry.id) || boqIds.has(entry.id) || entry.projectId !== value.projectId
      || !identifier(entry.contractId) || !(entry.deletedAt === null || isISODateTimeDTO(entry.deletedAt))
      || Object.keys(entry).some(key => !['id', 'projectId', 'contractId', 'deletedAt'].includes(key))) {
      return invalid('BOQ历史引用的身份、项目或时间无效')
    }
    boqIds.add(entry.id)
    return { id: entry.id, projectId: String(entry.projectId), contractId: entry.contractId, deletedAt: entry.deletedAt as string | null }
  })
  const tables = {} as QuantityMigrationGraph['tables']
  const numberFields = new Set(['sort_order', 'is_reporting_stage', 'file_size', 'recognized_contract_qty', 'contract_qty', 'provisional_qty', 'field_qty'])
  for (const table of QUANTITY_MIGRATION_TABLES) {
    const raw = value.tables[table]
    const columns: readonly string[] = QUANTITY_MIGRATION_COLUMNS[table]
    if (!Array.isArray(raw))
      invalid(`${table}必须完整提供数组`)
    const ids = new Set<string>()
    tables[table] = raw.map((input: unknown) => {
      if (!object(input) || Object.keys(input).some(key => !columns.includes(key)) || columns.some(key => !Object.hasOwn(input, key)))
        invalid(`${table}字段缺失或包含未识别字段`)
      for (const [key, field] of Object.entries(input)) {
        if (field !== null && (numberFields.has(key) ? typeof field !== 'number' || !Number.isFinite(field) : typeof field !== 'string'))
          invalid(`${table}.${key}类型无效`)
        if (numberFields.has(key) && field !== null && key !== 'sort_order' && Number(field) < 0)
          invalid(`${table}.${key}不能为负数`)
        if (['sort_order', 'file_size'].includes(key) && !Number.isSafeInteger(field))
          invalid(`${table}.${key}必须为整数`)
        if (['created_at', 'updated_at', 'uploaded_at'].includes(key) && !isISODateTimeDTO(field))
          invalid(`${table}.${key}必须为有效时间`)
        if (key === 'deleted_at' && field !== null && !isISODateTimeDTO(field))
          invalid(`${table}删除时间无效`)
      }
      const row = input as QuantityMigrationRow
      const id = row[table === 'file_payloads' ? 'file_ref_id' : 'id']
      if (!identifier(id) || ids.has(id))
        invalid(`${table}存在空或重复稳定 ID`)
      ids.add(id)
      return { ...row }
    })
  }
  const graph: QuantityMigrationGraph = { version: 1, projectId: value.projectId, archivedAt: value.archivedAt as string | null, boqReferences, tables }
  validateQuantityMigrationRelations(graph)
  return graph
}

export function validateQuantityMigrationRelations(graph: QuantityMigrationGraph) {
  const maps = Object.fromEntries(QUANTITY_MIGRATION_TABLES.map(table => [table, new Map(graph.tables[table].map(row => [quantityMigrationRowId(table, row), row]))])) as Record<QuantityMigrationTable, Map<string, QuantityMigrationRow>>
  function parent(table: QuantityMigrationTable, id: QuantityMigrationValue | undefined): QuantityMigrationRow {
    const row = typeof id === 'string' ? maps[table].get(id) : null
    if (!row)
      invalid(`找不到 ${table} 的显式父 ID ${String(id ?? '')}`)
    return row
  }
  for (const table of ['buildings', 'house_type_templates', 'items', 'construction_stages'] as const) {
    for (const row of graph.tables[table]) {
      if (row.project_id !== graph.projectId)
        invalid(`${table}跨项目引用`)
    }
  }
  for (const row of graph.tables.floors)
    parent('buildings', row.building_id)
  for (const row of graph.tables.rooms) {
    parent('house_type_templates', row.template_id)
    if (!['room', 'whole_unit'].includes(String(row.kind)))
      invalid('房间类型无效')
  }
  for (const row of graph.tables.house_type_templates) {
    if (row.copied_from_template_id !== null)
      parent('house_type_templates', row.copied_from_template_id)
  }
  for (const row of graph.tables.units) {
    parent('floors', row.floor_id)
    parent('house_type_templates', row.house_type_template_id)
  }
  for (const row of graph.tables.house_type_template_items) {
    parent('rooms', row.room_id)
    parent('items', row.item_id)
    if (row.boq_line_id !== null && !graph.boqReferences.some(reference => reference.id === row.boq_line_id))
      invalid('模板分项缺少显式历史BOQ身份')
  }
  for (const row of graph.tables.construction_stages) {
    if (!['unit', 'manual'].includes(String(row.completion_mode)))
      invalid('阶段完成模式无效')
  }
  const reporting = new Set<QuantityMigrationValue>()
  for (const row of graph.tables.construction_stage_items) {
    const stage = parent('construction_stages', row.stage_id)
    const item = parent('items', row.item_id)
    if (stage.trade !== item.trade || stage.completion_mode !== 'unit' || (row.is_reporting_stage !== 0 && row.is_reporting_stage !== 1))
      invalid('阶段映射的工种、计量模式或报量标记无效')
    if (row.deleted_at === null && row.is_reporting_stage === 1) {
      if (reporting.has(row.item_id!))
        invalid('同分项存在多个活跃报量阶段')
      reporting.add(row.item_id!)
    }
  }
  for (const row of graph.tables.unit_assignments) {
    parent('units', row.unit_id)
    if (identifier(row.crew_id) === identifier(row.worker_id))
      invalid('责任必须唯一指定班组或工人')
  }
  for (const row of graph.tables.unit_assignment_scopes) {
    parent('unit_assignments', row.assignment_id)
    parent('rooms', row.room_id)
    parent('items', row.item_id)
  }
  for (const row of graph.tables.unit_stage_completions) {
    parent('units', row.unit_id)
    const stage = parent('construction_stages', row.stage_id)
    const assignment = row.assignment_id === null ? null : parent('unit_assignments', row.assignment_id)
    if (stage.completion_mode !== 'unit' || (assignment && (assignment.unit_id !== row.unit_id || assignment.trade !== stage.trade))
      || !['draft', 'completed'].includes(String(row.status)) || (row.completed_at !== null && !isISODateDTO(row.completed_at) && !isISODateTimeDTO(row.completed_at))
      || (row.status === 'completed' && (!assignment || !row.completed_at))) {
      invalid('完成事实的户、工种、责任或日期不一致')
    }
  }
  for (const row of graph.tables.file_refs) {
    if (row.owner_type !== 'unit_stage_completion' || row.category !== 'acceptance_photo')
      invalid('附件不是阶段完成验收照片')
    parent('unit_stage_completions', row.owner_id)
  }
  for (const row of graph.tables.file_payloads) {
    const metadata = parent('file_refs', row.file_ref_id)
    if (row.encoding !== 'base64' || !identifier(row.content))
      invalid('照片正文编码或内容无效')
    validateQuantityPhoto({
      fileName: String(metadata.file_name ?? ''),
      mimeType: String(metadata.mime_type ?? ''),
      fileSize: metadata.file_size as number,
      contentBase64: row.content,
    })
  }
  for (const row of graph.tables.operation_logs) {
    if (!['create', 'update', 'delete', 'restore'].includes(String(row.action)))
      invalid('审计操作类型无效')
    if (row.table_name === 'projects') {
      if (row.record_id !== graph.projectId)
        invalid('项目审计不属于本工程量项目')
    }
    else if (typeof row.table_name === 'string' && QUANTITY_MIGRATION_TABLES.includes(row.table_name as QuantityMigrationTable) && row.table_name !== 'operation_logs') {
      parent(row.table_name as QuantityMigrationTable, row.record_id)
    }
    else {
      invalid('审计引用不属于工程量表')
    }
  }
}
