import type { QuantityMigrationGraph, QuantityMigrationRow, QuantityMigrationTable, QuantityMigrationValue } from './migration-graph'
import { quantityProblem } from './central-contract'
import { parseQuantityMigrationGraph, QUANTITY_MIGRATION_COLUMNS, QUANTITY_MIGRATION_TABLES, quantityMigrationRowId, quantityMigrationTimestamp } from './migration-graph'

export interface QuantityMigrationBindings {
  namespace: string
  projectId: string
  crews: ReadonlyMap<string, string>
  workers: ReadonlyMap<string, string>
  boqLineIds: ReadonlySet<string>
  contracts?: ReadonlyMap<string, string>
}
export interface QuantityMigrationIdentity {
  table: QuantityMigrationTable
  legacyId: string
  id: string
}

const INTERNAL_REFERENCES: Partial<Record<QuantityMigrationTable, Readonly<Record<string, QuantityMigrationTable>>>> = {
  house_type_templates: { copied_from_template_id: 'house_type_templates' },
  floors: { building_id: 'buildings' },
  rooms: { template_id: 'house_type_templates' },
  units: { floor_id: 'floors', house_type_template_id: 'house_type_templates' },
  house_type_template_items: { room_id: 'rooms', item_id: 'items' },
  construction_stage_items: { stage_id: 'construction_stages', item_id: 'items' },
  unit_assignments: { unit_id: 'units' },
  unit_assignment_scopes: { assignment_id: 'unit_assignments', room_id: 'rooms', item_id: 'items' },
  unit_stage_completions: { unit_id: 'units', stage_id: 'construction_stages', assignment_id: 'unit_assignments' },
  file_refs: { owner_id: 'unit_stage_completions' },
  file_payloads: { file_ref_id: 'file_refs' },
}

function invalid(message: string): never {
  throw quantityProblem('relationship-mismatch', `工程量迁移映射：${message}`)
}

/** 旧 ID 只通过明确映射转换。审计快照中的关系一并转换，保证未来撤销仍指向同一事实。 */
export function mapQuantityMigrationGraph(source: QuantityMigrationGraph, bindings: QuantityMigrationBindings) {
  const original = parseQuantityMigrationGraph(source)
  if (!bindings.namespace.trim() || !bindings.projectId.trim())
    invalid('缺少中央项目或批次身份')
  const identities: QuantityMigrationIdentity[] = []
  const maps = Object.fromEntries(QUANTITY_MIGRATION_TABLES.map(table => [table, new Map<string, string>()])) as Record<QuantityMigrationTable, Map<string, string>>
  for (const table of QUANTITY_MIGRATION_TABLES) {
    if (table === 'file_payloads')
      continue
    for (const row of original.tables[table]) {
      const legacyId = quantityMigrationRowId(table, row)
      const id = `${bindings.namespace}:${table}:${encodeURIComponent(legacyId)}`
      maps[table].set(legacyId, id)
      identities.push({ table, legacyId, id })
    }
  }
  for (const payload of original.tables.file_payloads) {
    const legacyId = quantityMigrationRowId('file_payloads', payload)
    const id = maps.file_refs.get(legacyId)
    if (!id)
      invalid(`照片正文缺少文件元数据 ${legacyId}`)
    maps.file_payloads.set(legacyId, id)
    identities.push({ table: 'file_payloads', legacyId, id })
  }
  function internal(table: QuantityMigrationTable, value: QuantityMigrationValue | undefined) {
    if (value === null)
      return null
    const id = typeof value === 'string' ? maps[table].get(value) : undefined
    if (!id)
      invalid(`${table} 缺少旧 ID ${String(value ?? '')}`)
    return id
  }
  function external(mapping: ReadonlyMap<string, string>, value: QuantityMigrationValue | undefined, kind: string) {
    if (value === null)
      return null
    const id = typeof value === 'string' ? mapping.get(value) : undefined
    if (!id)
      invalid(`${kind}缺少显式旧 ID ${String(value ?? '')}，不能按名称推断`)
    return id
  }
  function row(table: QuantityMigrationTable, input: QuantityMigrationRow): QuantityMigrationRow {
    const result = { ...input }
    if (Object.hasOwn(result, 'id'))
      result.id = internal(table, result.id)
    if (Object.hasOwn(result, 'project_id')) {
      if (result.project_id !== original.projectId)
        invalid(`${table}跨项目引用`)
      result.project_id = bindings.projectId
    }
    for (const [field, target] of Object.entries(INTERNAL_REFERENCES[table] ?? {})) {
      if (Object.hasOwn(result, field))
        result[field] = internal(target, result[field])
    }
    if (table === 'unit_assignments') {
      result.crew_id = external(bindings.crews, result.crew_id, '班组')
      result.worker_id = external(bindings.workers, result.worker_id, '工人')
    }
    if (table === 'house_type_template_items' && result.boq_line_id !== null && !bindings.boqLineIds.has(String(result.boq_line_id)) && !original.boqReferences.some(reference => reference.id === result.boq_line_id))
      invalid(`模板分项引用了不属于当前项目有效合同的 BOQ ${String(result.boq_line_id)}`)
    for (const [field, value] of Object.entries(result)) {
      if (['created_at', 'updated_at', 'uploaded_at', 'deleted_at'].includes(field))
        result[field] = quantityMigrationTimestamp(value, `${table}.${field}`)
    }
    return result
  }
  function snapshot(value: QuantityMigrationValue | undefined, table: string): string | null {
    if (value === null)
      return null
    let parsed: unknown
    try {
      parsed = typeof value === 'string' ? JSON.parse(value) : null
    }
    catch { invalid('审计快照不是有效 JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      invalid('审计快照必须为明确对象或空值')
    const before = parsed as QuantityMigrationRow
    if (table === 'projects') {
      if (before.id !== original.projectId)
        invalid('项目归档审计身份不一致')
      return JSON.stringify({ id: bindings.projectId, matrix_archived_at: quantityMigrationTimestamp(before.matrix_archived_at, '归档审计') })
    }
    const columns = QUANTITY_MIGRATION_COLUMNS[table as QuantityMigrationTable] as readonly string[] | undefined
    if (!columns || Object.keys(before).some(field => !columns.includes(field)))
      invalid('审计快照包含未知领域字段')
    return JSON.stringify(row(table as QuantityMigrationTable, before))
  }
  const tables = {} as QuantityMigrationGraph['tables']
  for (const table of QUANTITY_MIGRATION_TABLES) {
    tables[table] = original.tables[table].map((input) => {
      const result = row(table, input)
      if (table === 'operation_logs') {
        const target = String(input.table_name)
        result.record_id = target === 'projects' ? bindings.projectId : internal(target as QuantityMigrationTable, input.record_id)
        result.before_data = snapshot(input.before_data, target)
        result.after_data = snapshot(input.after_data, target)
      }
      return result
    })
  }
  const boqReferences = original.boqReferences.map(reference => ({
    ...reference,
    projectId: bindings.projectId,
    contractId: external(bindings.contracts ?? new Map(), reference.contractId, '施工合同')!,
  }))
  return { graph: parseQuantityMigrationGraph({ ...original, projectId: bindings.projectId, boqReferences, tables }), identities }
}
