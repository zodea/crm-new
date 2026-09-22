import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { BudgetMigrationPart, BudgetMigrationRow, BudgetVersionGraph } from '../../app/lib/migration/target-cost-source'
import { createHash } from 'node:crypto'
import { BUDGET_MIGRATION_COLUMNS, BUDGET_MIGRATION_TABLES, budgetLogBelongs, budgetLogSnapshot, parseBudgetVersionGraph } from '../../app/lib/migration/target-cost-source'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { advanceTargetCostRevision, initializeTargetCostSchema } from '../../app/lib/target-cost/central-schema'

export interface ImportedBudgetVersion {
  entityId: string
  batchId: string
  fingerprint: string
  /** 可信迁入基准；不能以会被删除或修改的日常日志代替。 */
  graph: BudgetVersionGraph
}
const parts = Object.keys(BUDGET_MIGRATION_TABLES) as BudgetMigrationPart[]
function invalid(message: string): never {
  throw targetCostProblem('conflict', `预算迁移：${message}`)
}
function rows(graph: BudgetVersionGraph, part: BudgetMigrationPart) {
  return part === 'head' ? [graph.head] : graph[part]
}
function rowKey(part: BudgetMigrationPart) {
  return part === 'payloads' ? 'file_ref_id' : 'id'
}

export function planBudgetMigration(snapshot: CoreMigrationSnapshotDTO, current: ReadonlyMap<string, ImportedBudgetVersion>) {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'target_cost_versions') : []
  const incomingIds = new Set(entities.map(row => row.id))
  if (incomingIds.size !== entities.length)
    invalid('版本身份重复')
  const removed = [...current.values()].filter(row => row.batchId !== batchId || !incomingIds.has(row.entityId))
  const imports = new Map([...current].filter(([, row]) => !removed.includes(row)))
  const incoming: ImportedBudgetVersion[] = []
  const baselines = new Set<string>()
  for (const entity of entities) {
    let input: unknown
    try {
      input = JSON.parse(String(entity.attributes.budgetGraphJson))
    }
    catch { invalid('完整版本图 JSON 无效') }
    const source = parseBudgetVersionGraph(input, entity.legacyId)
    const project = snapshot.entities.find(row => row.entityType === 'projects' && row.id === entity.references.projectId)
    if (!batchId || entity.batchId !== batchId || (source.head.project_id === null ? entity.references.projectId !== null : !project || project.legacyId !== source.head.project_id))
      invalid('项目映射与版本原始身份不一致')
    if (project && source.head.is_baseline === 1 && source.head.deleted_at === null) {
      if (baselines.has(project.id))
        invalid('同一项目存在多个未删除当前预算')
      baselines.add(project.id)
    }
    const fingerprint = createHash('sha256').update(JSON.stringify([source, project?.id ?? null])).digest('hex')
    const existing = imports.get(entity.id)
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        invalid('同批次预算来源变化，不能覆盖日常更正')
      continue
    }
    const mappedId = (table: string, value: unknown): string | null => {
      if (value === null)
        return null
      if (typeof value !== 'string' || !value)
        invalid('历史引用缺少稳定身份')
      if (table === 'target_costs') {
        if (value !== source.head.id)
          invalid('历史引用指向另一预算版本')
        return entity.id
      }
      if (table === 'projects') {
        const match = snapshot.entities.find(row => row.entityType === 'projects' && row.legacyId === value)
        if (!match)
          invalid('历史项目引用缺少显式迁入映射')
        return match.id
      }
      return `${entity.id}:${table}:${encodeURIComponent(value)}`
    }
    function mapRow(table: string, original: Record<string, unknown>): BudgetMigrationRow {
      const mapped = { ...original } as BudgetMigrationRow
      for (const [key, target] of Object.entries({ id: table, project_id: 'projects', target_cost_id: 'target_costs', file_ref_id: 'file_refs' })) {
        if (Object.hasOwn(mapped, key))
          mapped[key] = mappedId(target, mapped[key])
      }
      if (table === 'file_refs' && Object.hasOwn(mapped, 'owner_id')) {
        if (mapped.owner_type !== 'target_cost')
          invalid('历史附件缺少明确预算归属')
        mapped.owner_id = mappedId('target_costs', mapped.owner_id)
      }
      return mapped
    }
    const graph: BudgetVersionGraph = { schemaVersion: 1, head: mapRow('target_costs', source.head), items: source.items.map(row => mapRow('target_cost_items', row)), files: source.files.map(row => mapRow('file_refs', row)), payloads: source.payloads.map(row => mapRow('file_payloads', row)), logs: source.logs.map((row) => {
      const mapped = mapRow('operation_logs', row)
      mapped.record_id = mappedId(String(row.table_name), row.record_id)
      for (const key of ['before_data', 'after_data']) {
        const value = budgetLogSnapshot(row[key])
        mapped[key] = value === null ? null : JSON.stringify(mapRow(String(row.table_name), value))
      }
      return mapped
    }) }
    incoming.push({ entityId: entity.id, batchId, fingerprint, graph: parseBudgetVersionGraph(graph) })
  }
  return { incoming, removed, imports, snapshot }
}

async function currentBudgetGraph(db: TransactionDb, id: string): Promise<BudgetVersionGraph | null> {
  const [head] = await db.select<BudgetMigrationRow>(`SELECT ${BUDGET_MIGRATION_COLUMNS.head.join(',')} FROM target_costs WHERE id = ?`, [id])
  if (!head)
    return null
  const items = await db.select<BudgetMigrationRow>(`SELECT ${BUDGET_MIGRATION_COLUMNS.items.join(',')} FROM target_cost_items WHERE target_cost_id = ?`, [id])
  const files = await db.select<BudgetMigrationRow>(`SELECT ${BUDGET_MIGRATION_COLUMNS.files.join(',')} FROM file_refs WHERE owner_type = 'target_cost' AND owner_id = ?`, [id])
  const payloads = await db.select<BudgetMigrationRow>(`SELECT ${BUDGET_MIGRATION_COLUMNS.payloads.map(key => `p.${key}`).join(',')} FROM file_payloads p JOIN file_refs f ON f.id = p.file_ref_id WHERE f.owner_type = 'target_cost' AND f.owner_id = ?`, [id])
  const logs = (await db.select<BudgetMigrationRow>(`SELECT ${BUDGET_MIGRATION_COLUMNS.logs.join(',')} FROM operation_logs WHERE table_name IN ('target_costs','target_cost_items','file_refs')`)).filter(log => budgetLogBelongs(log, { head, items, files }))
  return { schemaVersion: 1, head, items, files, payloads, logs }
}
function graphFingerprint(graph: BudgetVersionGraph) {
  return JSON.stringify(parts.map(part => rows(graph, part).toSorted((a, b) => String(a[rowKey(part)]).localeCompare(String(b[rowKey(part)]))).map(row => BUDGET_MIGRATION_COLUMNS[part].map(key => row[key]))))
}

/** 在任何候选删除前保住日常事实与跨版本/项目历史引用，软删除并不解除来源责任。 */
export async function applyBudgetMigration(db: TransactionDb, plan: ReturnType<typeof planBudgetMigration>, removedProjectIds: ReadonlySet<string>) {
  await initializeTargetCostSchema(db)
  const removedIds = new Set(plan.removed.map(row => row.entityId))
  for (const previous of plan.removed) {
    const actual = await currentBudgetGraph(db, previous.entityId)
    const receipts = await db.select('SELECT command_id FROM target_cost_command_receipts WHERE target_cost_id = ? LIMIT 1', [previous.entityId])
    if (!actual || graphFingerprint(actual) !== graphFingerprint(previous.graph) || receipts.length)
      invalid('迁入后预算或附件已有日常变更，恢复会丢失当前事实；已保留全部版本与审计')
  }
  const heads = await db.select<{ id: string, project_id: string | null }>('SELECT id,project_id FROM target_costs')
  if (heads.some(row => !removedIds.has(row.id) && row.project_id !== null && removedProjectIds.has(row.project_id)))
    invalid('独立预算仍引用待撤项目，已阻止恢复')
  if (removedIds.size || removedProjectIds.size) {
    const ownedLogs = new Set(plan.removed.flatMap(row => row.graph.logs.map(log => log.id)))
    const logs = await db.select<BudgetMigrationRow>(`SELECT ${BUDGET_MIGRATION_COLUMNS.logs.join(',')} FROM operation_logs WHERE table_name IN ('target_costs','target_cost_items','file_refs')`)
    for (const log of logs.filter(row => !ownedLogs.has(row.id))) {
      for (const value of [log.before_data, log.after_data]) {
        const data = budgetLogSnapshot(value)
        if (log.table_name === 'file_refs' && data?.owner_type !== 'target_cost')
          continue
        if (data && (removedProjectIds.has(String(data.project_id)) || removedIds.has(String(data.target_cost_id)) || (data.owner_type === 'target_cost' && removedIds.has(String(data.owner_id)))))
          invalid('独立预算历史仍引用待撤项目或版本，已阻止恢复')
      }
    }
  }
  for (const previous of plan.removed) {
    for (const part of [...parts].reverse()) {
      for (const row of rows(previous.graph, part))
        await db.execute(`DELETE FROM ${BUDGET_MIGRATION_TABLES[part]} WHERE ${rowKey(part)} = ?`, [row[rowKey(part)]])
    }
  }
  for (const next of plan.incoming) {
    const project = plan.snapshot.entities.find(row => row.entityType === 'projects' && row.id === next.graph.head.project_id)
    if (project)
      await db.execute('INSERT INTO projects (id,name,deleted_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING', [project.id, project.name, project.deletedAt])
    for (const part of parts) {
      const columns = BUDGET_MIGRATION_COLUMNS[part]
      for (const row of rows(next.graph, part)) {
        await db.execute(`INSERT INTO ${BUDGET_MIGRATION_TABLES[part]} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, columns.map(key => row[key]))
        const [actual] = await db.select<BudgetMigrationRow>(`SELECT ${columns.join(',')} FROM ${BUDGET_MIGRATION_TABLES[part]} WHERE ${rowKey(part)} = ?`, [row[rowKey(part)]])
        if (!actual || columns.some(key => actual[key] !== row[key]))
          invalid(`${part} 写后字段对账不一致`)
      }
    }
    plan.imports.set(next.entityId, next)
  }
  if (plan.removed.length || plan.incoming.length)
    await advanceTargetCostRevision(db)
}
