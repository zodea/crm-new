import type { SoftDb } from '../db/soft-delete'
import type { CoreMigrationSourceEntityDTO } from './core-contract'
import { quantityMigrationTimestamp } from '../quantity/migration-graph'

const identity = ['id', 'created_at', 'updated_at', 'deleted_at'] as const
/** 每个版本是一份完整原图；不按项目分桶、不经可见性过滤掉历史。 */
export const BUDGET_MIGRATION_COLUMNS = {
  head: [...identity, 'project_id', 'name', 'is_baseline', 'contract_revenue', 'planned_profit', 'signed_contract_sum', 'tax_inclusive_total', 'tax_exclusive_total', 'tax_amount', 'status', 'note'],
  items: [...identity, 'target_cost_id', 'cost_category', 'item_name', 'unit', 'qty', 'unit_price', 'amount', 'note', 'sort_order'],
  files: ['id', 'owner_type', 'owner_id', 'file_name', 'file_path', 'file_size', 'mime_type', 'category', 'uploader', 'uploaded_at', 'deleted_at'],
  payloads: ['file_ref_id', 'encoding', 'content'],
  logs: ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at'],
} as const
export const BUDGET_MIGRATION_TABLES = { head: 'target_costs', items: 'target_cost_items', files: 'file_refs', payloads: 'file_payloads', logs: 'operation_logs' } as const
export type BudgetMigrationPart = keyof typeof BUDGET_MIGRATION_COLUMNS
export type BudgetMigrationRow = Record<string, string | number | null>
export interface BudgetVersionGraph {
  schemaVersion: 1
  head: BudgetMigrationRow
  items: BudgetMigrationRow[]
  files: BudgetMigrationRow[]
  payloads: BudgetMigrationRow[]
  logs: BudgetMigrationRow[]
}
const parts = ['items', 'files', 'payloads', 'logs'] as const
const numbers = new Set(['is_baseline', 'contract_revenue', 'planned_profit', 'signed_contract_sum', 'tax_inclusive_total', 'tax_exclusive_total', 'tax_amount', 'qty', 'unit_price', 'amount', 'sort_order', 'file_size'])
const dates = new Set(['created_at', 'updated_at', 'deleted_at', 'uploaded_at'])
const nullable: Record<BudgetMigrationPart, ReadonlySet<string>> = {
  head: new Set(['project_id', 'contract_revenue', 'planned_profit', 'signed_contract_sum', 'tax_inclusive_total', 'tax_exclusive_total', 'tax_amount', 'deleted_at']),
  items: new Set(['item_name', 'unit', 'qty', 'unit_price', 'deleted_at']),
  files: new Set(['file_name', 'file_path', 'file_size', 'mime_type', 'category', 'uploader', 'uploaded_at', 'deleted_at']),
  payloads: new Set(),
  logs: new Set(['before_data', 'after_data', 'operator', 'created_at']),
}
const categories = ['专业分包', '合同劳务', '材料', '机械', '工人工资', '费用报销', '其他']
function invalid(message: string): never {
  throw new Error(`预算迁移：${message}`)
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
}
function row(value: unknown, part: BudgetMigrationPart): BudgetMigrationRow {
  const keys: readonly string[] = BUDGET_MIGRATION_COLUMNS[part]
  if (!object(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key)))
    invalid(`${part}字段缺失或未知`)
  const result: BudgetMigrationRow = {}
  for (const key of keys) {
    const entry = value[key]
    if (entry === null && !nullable[part].has(key))
      invalid(`${part}.${key}违反原表非空约束`)
    if (dates.has(key)) {
      result[key] = quantityMigrationTimestamp(entry, `预算${part}.${key}`)
    }
    else if (numbers.has(key)) {
      if (entry !== null && (typeof entry !== 'number' || !Number.isFinite(entry) || (key !== 'sort_order' && entry < 0)))
        invalid(`${part}.${key}数值无效`)
      result[key] = entry as number | null
    }
    else {
      if (entry !== null && typeof entry !== 'string')
        invalid(`${part}.${key}必须为文本或空值`)
      result[key] = entry as string | null
    }
  }
  if (!id(result[part === 'payloads' ? 'file_ref_id' : 'id']))
    invalid(`${part}缺少稳定身份`)
  return result
}
export function budgetLogSnapshot(value: unknown): Record<string, unknown> | null {
  if (value === null)
    return null
  let result: unknown
  try {
    result = JSON.parse(String(value))
  }
  catch { return invalid('历史日志 JSON 无法识别') }
  if (!object(result))
    invalid('历史日志快照必须为对象或空值')
  return result
}
export function budgetLogBelongs(log: BudgetMigrationRow, graph: Pick<BudgetVersionGraph, 'head' | 'items' | 'files'>): boolean {
  if (log.table_name === 'target_costs')
    return log.record_id === graph.head.id
  if (log.table_name === 'target_cost_items') {
    if (graph.items.some(item => item.id === log.record_id))
      return true
    return [log.before_data, log.after_data].some(value => budgetLogSnapshot(value)?.target_cost_id === graph.head.id)
  }
  if (log.table_name === 'file_refs') {
    if (graph.files.some(file => file.id === log.record_id))
      return true
    return [log.before_data, log.after_data].some((value) => {
      const snapshot = budgetLogSnapshot(value)
      return snapshot?.owner_type === 'target_cost' && snapshot.owner_id === graph.head.id
    })
  }
  return false
}
export function parseBudgetVersionGraph(value: unknown, legacyId?: string): BudgetVersionGraph {
  if (!object(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion', 'head', ...parts].includes(key)))
    invalid('完整版本图结构无效')
  const head = row(value.head, 'head')
  if ((legacyId && head.id !== legacyId) || (head.project_id !== null && !id(head.project_id)) || typeof head.name !== 'string'
    || (head.is_baseline !== 0 && head.is_baseline !== 1) || !['draft', 'submitted'].includes(String(head.status))) {
    invalid('版本身份、项目或状态无效')
  }
  const graph: BudgetVersionGraph = { schemaVersion: 1, head, items: [], files: [], payloads: [], logs: [] }
  for (const part of parts) {
    if (!Array.isArray(value[part]))
      invalid(`${part}必须完整提供`)
    const seen = new Set<string | number | null>()
    graph[part] = value[part].map((entry) => {
      const current = row(entry, part)
      const key = current[part === 'payloads' ? 'file_ref_id' : 'id']!
      if (seen.has(key))
        invalid(`${part}身份重复`)
      seen.add(key)
      return current
    })
  }
  for (const item of graph.items) {
    if (item.target_cost_id !== head.id || !categories.includes(String(item.cost_category)) || item.amount === null || !Number.isSafeInteger(item.sort_order))
      invalid('明细版本关系、科目、目标金额或顺序无效')
  }
  for (const file of graph.files) {
    if (file.owner_type !== 'target_cost' || file.owner_id !== head.id || (file.file_size !== null && !Number.isSafeInteger(file.file_size)))
      invalid('附件预算归属或元数据无效')
  }
  for (const payload of graph.payloads) {
    const file = graph.files.find(file => file.id === payload.file_ref_id)
    if (!file || payload.encoding !== 'base64' || typeof payload.content !== 'string')
      invalid('附件正文缺少所属原件或编码无效')
    let binary = ''
    try {
      binary = atob(payload.content)
    }
    catch { invalid('附件正文 Base64 损坏') }
    if (btoa(binary) !== payload.content || (file.file_size !== null && binary.length !== file.file_size))
      invalid('附件正文与元数据长度不一致')
  }
  for (const log of graph.logs) {
    if (!budgetLogBelongs(log, graph) || !['create', 'update', 'delete', 'restore'].includes(String(log.action)))
      invalid('历史日志缺少明确版本归属或动作无效')
    budgetLogSnapshot(log.before_data)
    budgetLogSnapshot(log.after_data)
  }
  return graph
}
export async function readBudgetVersionMigrationGraphs(db: Pick<SoftDb, 'select'>): Promise<CoreMigrationSourceEntityDTO[]> {
  const loaded = await Promise.all(Object.entries(BUDGET_MIGRATION_TABLES).map(async ([part, table]) => [part, await db.select<BudgetMigrationRow>(`SELECT ${BUDGET_MIGRATION_COLUMNS[part as BudgetMigrationPart].join(', ')} FROM ${table} ORDER BY ${part === 'payloads' ? 'file_ref_id' : 'id'}`)] as const))
  const tables = Object.fromEntries(loaded) as Record<BudgetMigrationPart, BudgetMigrationRow[]>
  const headIds = new Set(tables.head.map(head => head.id))
  if (tables.items.some(item => !headIds.has(item.target_cost_id)) || tables.files.some(file => file.owner_type === 'target_cost' && !headIds.has(file.owner_id)))
    invalid('预算明细或附件存在缺失版本祖先')
  return tables.head.map((head) => {
    const items = tables.items.filter(item => item.target_cost_id === head.id)
    const files = tables.files.filter(file => file.owner_type === 'target_cost' && file.owner_id === head.id)
    const graph = parseBudgetVersionGraph({ schemaVersion: 1, head, items, files, payloads: tables.payloads.filter(payload => files.some(file => file.id === payload.file_ref_id)), logs: tables.logs.filter(log => budgetLogBelongs(log, { head, items, files })) })
    return { legacyId: String(head.id), name: String(head.name || '未命名预算草稿'), references: { projectId: head.project_id as string | null }, amount: head.tax_inclusive_total === null ? null : Number(head.tax_inclusive_total).toFixed(2), deletedAt: graph.head.deleted_at as string | null, attributes: { budgetGraphJson: JSON.stringify(graph) } }
  })
}
