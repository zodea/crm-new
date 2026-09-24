import type { QuantityHollowRow, QuantityHollowTable, QuantityHollowTables } from './central-hollow-schema'
import type { QuantityHollowCommandKey, QuantityHollowIdentityBinding, QuantityHollowIdentityTable, QuantityHollowMigrationGraph, QuantityHollowOriginBody } from './hollow-migration-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { quantityProblem } from './central-contract'
import { QUANTITY_HOLLOW_COLUMNS, QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS, QUANTITY_HOLLOW_TABLES } from './central-hollow-schema'

export function hollowMigrationInvalid(message: string): never {
  throw quantityProblem('relationship-mismatch', `工程量迁移空鼓原件：${message}`)
}
export function hollowObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function hollowIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
export function hollowExact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return hollowObject(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
}
export const hollowDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export const hollowIdentityTables = [...new Set([...QUANTITY_HOLLOW_TABLES, ...Object.keys(QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS)])] as QuantityHollowIdentityTable[]
export const hollowRowKey = (table: string, id: unknown) => JSON.stringify([table, id])
export const hollowCommandIdentity = (key: QuantityHollowCommandKey) => JSON.stringify([key.workspaceId, key.actorId, key.commandId])
export function emptyQuantityHollowTables(): QuantityHollowTables {
  return Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, []])) as unknown as QuantityHollowTables
}
export function emptyQuantityHollowMigrationGraph(): QuantityHollowMigrationGraph {
  return { schemaVersion: 1, tables: emptyQuantityHollowTables(), origins: [], bindings: [], rowOrigins: [] }
}
export async function quantityHollowHash(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 结构检查不重写任何原 JSON；原文相互证明由 prove/extend 完成。 */
export function parseQuantityHollowTables(value: unknown): QuantityHollowTables {
  if (!hollowExact(value, QUANTITY_HOLLOW_TABLES))
    hollowMigrationInvalid('五表必须完整提供且不得带未知表')
  const tables = emptyQuantityHollowTables()
  for (const table of QUANTITY_HOLLOW_TABLES) {
    const rows = value[table]
    if (!Array.isArray(rows))
      hollowMigrationInvalid(`${table}必须是完整数组`)
    const ids = new Set<string>()
    tables[table] = rows.map((row): QuantityHollowRow => {
      const columns = QUANTITY_HOLLOW_COLUMNS[table]
      if (!hollowExact(row, columns) || !hollowIdentifier(row.id) || ids.has(row.id))
        hollowMigrationInvalid(`${table}字段缺失、未知或身份重复`)
      ids.add(row.id)
      for (const column of columns) {
        const entry = row[column]
        if (entry === null && ['previous_revision_id', 'previous_log_id', 'rectification_id', 'reason'].includes(column))
          continue
        if (column === 'count') {
          if (!Number.isSafeInteger(entry) || Number(entry) < (table === 'quantity_hollow_rectifications' ? 1 : 0))
            hollowMigrationInvalid(`${table}处数无效`)
        }
        else if (typeof entry !== 'string') {
          hollowMigrationInvalid(`${table}.${column}必须保留原文本`)
        }
        else if (column.endsWith('_fingerprint') && !hollowDigest(entry)) {
          hollowMigrationInvalid(`${table}.${column}摘要无效`)
        }
        else if (column === 'created_at' && !isISODateTimeDTO(entry)) {
          hollowMigrationInvalid(`${table}原时间无效`)
        }
        else if (['inspected_on', 'rectified_on'].includes(column) && !isISODateDTO(entry)) {
          hollowMigrationInvalid(`${table}原日期无效`)
        }
        else if ((column === 'id' || column.endsWith('_id')) && !hollowIdentifier(entry)) {
          hollowMigrationInvalid(`${table}.${column}缺少身份`)
        }
      }
      return { ...row } as QuantityHollowRow
    })
  }
  return tables
}

export function parseQuantityHollowOriginBody(raw: string): QuantityHollowOriginBody {
  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch { hollowMigrationInvalid('原件片段不是合法JSON') }
  if (!hollowExact(value, ['schemaVersion', 'kind', 'projectId', 'recordId', 'base', 'tables']) || value.schemaVersion !== 1 || !['root', 'suffix'].includes(String(value.kind)) || !hollowIdentifier(value.projectId) || !hollowIdentifier(value.recordId))
    hollowMigrationInvalid('原件片段结构无效')
  if (value.kind === 'root' ? value.base !== null : !hollowExact(value.base, ['originId', 'recordId', 'headLogId', 'fingerprint']) || !hollowDigest(value.base.originId) || !hollowIdentifier(value.base.recordId) || !hollowIdentifier(value.base.headLogId) || !hollowDigest(value.base.fingerprint))
    hollowMigrationInvalid('原件前缀引用无效')
  const tables = parseQuantityHollowTables(value.tables)
  if (value.kind === 'root' ? tables.quantity_hollow_records.length !== 1 || tables.quantity_hollow_records[0]!.id !== value.recordId : tables.quantity_hollow_records.length !== 0)
    hollowMigrationInvalid('根与续链片段的拥有行无效')
  if (!tables.quantity_hollow_logs.length)
    hollowMigrationInvalid('空的原件片段不能冒充续链')
  return { ...value, tables } as unknown as QuantityHollowOriginBody
}

function commandKey(value: unknown): value is QuantityHollowCommandKey {
  return hollowExact(value, ['workspaceId', 'actorId', 'commandId']) && Object.values(value).every(hollowIdentifier)
}
function parseBinding(value: unknown): QuantityHollowIdentityBinding {
  if (hollowExact(value, ['kind', 'table', 'sourceId', 'exportedId']) && value.kind === 'row' && hollowIdentityTables.includes(value.table as QuantityHollowIdentityTable) && hollowIdentifier(value.sourceId) && hollowIdentifier(value.exportedId))
    return value as unknown as QuantityHollowIdentityBinding
  if (hollowExact(value, ['kind', 'source', 'exported']) && value.kind === 'command' && commandKey(value.source) && commandKey(value.exported) && value.source.workspaceId === value.exported.workspaceId && value.source.actorId === value.exported.actorId)
    return value as unknown as QuantityHollowIdentityBinding
  return hollowMigrationInvalid('身份映射不是封闭实体或命令三元组')
}

export function parseQuantityHollowMigrationGraph(value: unknown): QuantityHollowMigrationGraph {
  if (!hollowExact(value, ['schemaVersion', 'tables', 'origins', 'bindings', 'rowOrigins']) || value.schemaVersion !== 1 || !Array.isArray(value.origins) || !Array.isArray(value.bindings) || !Array.isArray(value.rowOrigins))
    hollowMigrationInvalid('子图必须具备五表、扁平原件、映射及逐行归属')
  const tables = parseQuantityHollowTables(value.tables)
  const originIds = new Set<string>()
  const bodies = new Map<string, QuantityHollowOriginBody>()
  const origins = value.origins.map((origin) => {
    if (!hollowExact(origin, ['id', 'bodyJson']) || !hollowDigest(origin.id) || typeof origin.bodyJson !== 'string' || originIds.has(origin.id))
      hollowMigrationInvalid('原件身份重复或结构无效')
    originIds.add(origin.id)
    bodies.set(origin.id, parseQuantityHollowOriginBody(origin.bodyJson))
    return { id: origin.id, bodyJson: origin.bodyJson }
  })
  const bound = new Set<string>()
  const bindings = value.bindings.map((binding) => {
    if (!hollowExact(binding, ['originId', 'identities']) || typeof binding.originId !== 'string' || !originIds.has(binding.originId) || bound.has(binding.originId) || !Array.isArray(binding.identities))
      hollowMigrationInvalid('原件映射缺失、重复或无所属原件')
    bound.add(binding.originId)
    const identities = binding.identities.map(parseBinding)
    const from = identities.map(item => item.kind === 'row' ? hollowRowKey(item.table, item.sourceId) : hollowRowKey('command', hollowCommandIdentity(item.source)))
    const to = identities.map(item => item.kind === 'row' ? hollowRowKey(item.table, item.exportedId) : hollowRowKey('command', hollowCommandIdentity(item.exported)))
    if (new Set(from).size !== from.length || new Set(to).size !== to.length)
      hollowMigrationInvalid('同一原件的映射必须唯一且可逆')
    return { originId: binding.originId, identities }
  })
  if (bound.size !== originIds.size)
    hollowMigrationInvalid('原件缺少完整映射')
  const exportedKeys = new Set(QUANTITY_HOLLOW_TABLES.flatMap(table => tables[table].map(row => hollowRowKey(table, row.id))))
  const sourceKeys = new Set(origins.flatMap(origin => QUANTITY_HOLLOW_TABLES.flatMap(table => bodies.get(origin.id)!.tables[table].map(row => JSON.stringify([origin.id, table, row.id])))))
  const seenExports = new Set<string>()
  const seenSources = new Set<string>()
  const rowOrigins = value.rowOrigins.map((entry) => {
    if (!hollowExact(entry, ['table', 'exportedId', 'originId', 'sourceId']) || !QUANTITY_HOLLOW_TABLES.includes(entry.table as QuantityHollowTable) || !hollowIdentifier(entry.exportedId) || !hollowIdentifier(entry.sourceId) || typeof entry.originId !== 'string' || !originIds.has(entry.originId))
      hollowMigrationInvalid('逐行原件归属无效')
    const exported = hollowRowKey(String(entry.table), entry.exportedId)
    const source = JSON.stringify([entry.originId, entry.table, entry.sourceId])
    if (!exportedKeys.has(exported) || seenExports.has(exported) || !sourceKeys.has(source) || seenSources.has(source))
      hollowMigrationInvalid('五表与原件拥有行必须恰好一一对应')
    const mapped = bindings.find(item => item.originId === entry.originId)!.identities.find(item => item.kind === 'row' && item.table === entry.table && item.sourceId === entry.sourceId)
    if (!mapped || mapped.kind !== 'row' || mapped.exportedId !== entry.exportedId)
      hollowMigrationInvalid('原件拥有行与映射不一致')
    seenExports.add(exported)
    seenSources.add(source)
    return { table: entry.table as QuantityHollowTable, exportedId: entry.exportedId, originId: entry.originId, sourceId: entry.sourceId }
  })
  if (seenExports.size !== exportedKeys.size || seenSources.size !== sourceKeys.size)
    hollowMigrationInvalid('五表存在没有原件的行或原件存在遗漏行')
  const ready = new Set<string>()
  while (ready.size < origins.length) {
    const next = origins.find(origin => !ready.has(origin.id) && (!bodies.get(origin.id)!.base || ready.has(bodies.get(origin.id)!.base!.originId)))
    if (!next)
      hollowMigrationInvalid('原件依赖缺失或形成循环')
    ready.add(next.id)
  }
  return { schemaVersion: 1, tables, origins, bindings, rowOrigins }
}
