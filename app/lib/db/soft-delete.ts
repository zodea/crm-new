// 软删除 + 操作日志(#52)——纯函数,node 可测,驱动注入(与 migrations.ts 同模式)。
// 权威口径:DATABASE.md §8(软删除/操作日志/撤回)+ ADR 0003(级联只标父级、查询按「祖先未删」过滤)。
import type { MigrationDb } from './migrations'
import { generateId } from '~/lib/util/id'
import { assertIdentifier } from './migrations'

export type SoftDb = MigrationDb

export interface ParentRef {
  /** 本表指向父表的外键列(可空列 NULL 视为无父,不影响可见性) */
  column: string
  /** 父表名 */
  table: string
}

/**
 * 业务表父引用图——祖先过滤依据:一条记录被隐藏 = 自身被删 OR 其任一祖先被删(ADR 0003)。
 * 注意这是「语义父子」超集,不等于 schema 的 REFERENCES 声明(含软外键,如
 * invoices.project_id、payment_records.payment_application_id)。给存量表加关联列时
 * 必须手动同步登记,漂移由 tests/db/soft-delete.test.ts 的交叉校验拦截。
 * file_refs 为多态关联(owner_type/owner_id),静态 SQL 无法表达,查询方须按 owner 过滤。
 */
export const PARENT_REFS: Record<string, ParentRef[]> = {
  projects: [],
  project_aliases: [{ column: 'project_id', table: 'projects' }],
  suppliers: [{ column: 'parent_supplier_id', table: 'suppliers' }],
  invoices: [
    { column: 'project_id', table: 'projects' },
    { column: 'supplier_id', table: 'suppliers' },
  ],
  crews: [],
  items: [{ column: 'project_id', table: 'projects' }],
  buildings: [{ column: 'project_id', table: 'projects' }],
  floors: [{ column: 'building_id', table: 'buildings' }],
  house_type_templates: [{ column: 'project_id', table: 'projects' }],
  rooms: [{ column: 'template_id', table: 'house_type_templates' }],
  units: [
    { column: 'floor_id', table: 'floors' },
    { column: 'house_type_template_id', table: 'house_type_templates' },
  ],
  house_type_template_items: [
    { column: 'room_id', table: 'rooms' },
    { column: 'item_id', table: 'items' },
  ],
  construction_stages: [{ column: 'project_id', table: 'projects' }],
  construction_stage_items: [
    { column: 'stage_id', table: 'construction_stages' },
    { column: 'item_id', table: 'items' },
  ],
  unit_assignments: [
    { column: 'unit_id', table: 'units' },
    { column: 'crew_id', table: 'crews' },
    { column: 'worker_id', table: 'workers' },
  ],
  unit_assignment_scopes: [
    { column: 'assignment_id', table: 'unit_assignments' },
    { column: 'room_id', table: 'rooms' },
    { column: 'item_id', table: 'items' },
  ],
  // assignment_id 仅为完成时责任审计引用；责任软删不得吞掉历史完成事实。
  unit_stage_completions: [
    { column: 'unit_id', table: 'units' },
    { column: 'stage_id', table: 'construction_stages' },
  ],
  supplier_credentials: [{ column: 'supplier_id', table: 'suppliers' }],
  project_suppliers: [
    { column: 'project_id', table: 'projects' },
    { column: 'supplier_id', table: 'suppliers' },
  ],
  phase_tasks: [{ column: 'project_id', table: 'projects' }],
  construction_contracts: [{ column: 'project_id', table: 'projects' }],
  owner_change_orders: [{ column: 'project_id', table: 'projects' }],
  expenditure_contracts: [
    { column: 'project_id', table: 'projects' },
    { column: 'supplier_id', table: 'suppliers' },
  ],
  // 合同域轻实体仓(#90 批A,v3 迁移):施工/分包/材采单表 kind 区分;施工合同 supplier_id 为 NULL
  contracts: [
    { column: 'project_id', table: 'projects' },
    { column: 'supplier_id', table: 'suppliers' },
  ],
  delivery_records: [
    { column: 'project_id', table: 'projects' },
    { column: 'supplier_id', table: 'suppliers' },
  ],
  delivery_lines: [{ column: 'delivery_record_id', table: 'delivery_records' }],
  invoice_applications: [{ column: 'project_id', table: 'projects' }],
  receipt_registrations: [{ column: 'project_id', table: 'projects' }],
  current_receipts: [{ column: 'project_id', table: 'projects' }],
  current_payments: [{ column: 'project_id', table: 'projects' }],
  payment_records: [
    { column: 'project_id', table: 'projects' },
    { column: 'payment_application_id', table: 'payment_applications' },
  ],
  workers: [{ column: 'crew_id', table: 'crews' }],
  settlements: [{ column: 'project_supplier_id', table: 'project_suppliers' }],
  supplement_agreements: [{ column: 'contract_id', table: 'construction_contracts' }],
  contract_line_items: [{ column: 'contract_id', table: 'expenditure_contracts' }],
  payment_applications: [
    { column: 'project_id', table: 'projects' },
    { column: 'supplier_id', table: 'suppliers' },
    { column: 'contract_id', table: 'expenditure_contracts' },
  ],
  file_refs: [],
}

/** 全部业务表(= 父引用图的键;新增表必须同步登记父引用) */
export const BUSINESS_TABLES = Object.keys(PARENT_REFS)

/** 物理存在(v1 基线遗留)但已废弃的表,禁止业务读写:ticket_registrations → invoices 单表(ADR-0001) */
export const DEPRECATED_TABLES = ['ticket_registrations']

/** 不参与通用软删除与操作日志的基础设施表；file_payloads 避免正文进入通用快照。 */
export const INFRA_TABLES = ['schema_migrations', 'operation_logs', 'file_payloads']

function assertBusinessTable(table: string): void {
  if (!(table in PARENT_REFS)) {
    throw new Error(`[db] 未登记的业务表: ${table}`)
  }
}

function isSelfRef(table: string): boolean {
  return (PARENT_REFS[table] ?? []).some(ref => ref.table === table)
}

/**
 * 查询 table 需要的隐藏集 CTE 表清单:祖先闭包(父先于子),
 * 自引用表(如 suppliers)含自身——其 CTE 用递归项覆盖任意深度。
 */
function cteTables(table: string): string[] {
  assertBusinessTable(table)
  const ordered: string[] = []
  const visited = new Set<string>()
  function visit(t: string, isRoot: boolean): void {
    if (visited.has(t))
      return
    visited.add(t)
    for (const ref of PARENT_REFS[t]!) {
      if (ref.table !== t)
        visit(ref.table, false)
    }
    if (!isRoot || isSelfRef(t))
      ordered.push(t)
  }
  visit(table, true)
  return ordered
}

/**
 * 隐藏集 CTE 前缀(祖先过滤,ADR 0003):hidden_<表>(id) = 自身被删 ∪ 父级在隐藏集中。
 * 无祖先依赖时返回空串。用法:
 *   `${hiddenCtes(t)} SELECT * FROM t WHERE ${visibleCond(t)}`
 */
export function hiddenCtesFor(...roots: string[]): string {
  const tables: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    for (const table of cteTables(root)) {
      if (seen.has(table))
        continue
      seen.add(table)
      tables.push(table)
    }
  }
  if (!tables.length)
    return ''
  // DFS 后序保证父表 CTE 先定义;跨表成环不支持(自引用除外),成环时 SQL prepare 期报 no such table
  const defs = tables.map((t) => {
    const arms = [`SELECT id FROM "${t}" WHERE deleted_at IS NOT NULL`]
    for (const ref of PARENT_REFS[t]!) {
      arms.push(`SELECT c.id FROM "${t}" c JOIN hidden_${ref.table} h ON c."${ref.column}" = h.id`)
    }
    return `hidden_${t}(id) AS (\n  ${arms.join('\n  UNION\n  ')}\n)`
  })
  return `WITH RECURSIVE ${defs.join(',\n')}`
}

export function hiddenCtes(table: string): string {
  return hiddenCtesFor(table)
}

/**
 * 可见性条件(配合 hiddenCtes 前缀):自身未删 AND 每个父引用为 NULL 或不在父级隐藏集。
 * 一条记录被隐藏 = 自身被删 OR 其任一祖先被删(ADR 0003)。
 */
export function visibleCond(table: string, alias = table): string {
  assertBusinessTable(table)
  assertIdentifier(alias)
  const parts = [`${alias}.deleted_at IS NULL`]
  for (const ref of PARENT_REFS[table]!) {
    parts.push(
      `(${alias}."${ref.column}" IS NULL OR ${alias}."${ref.column}" NOT IN (SELECT id FROM hidden_${ref.table}))`,
    )
  }
  return parts.join(' AND ')
}

/**
 * 唯一「祝福读路径」:整句可见查询(隐藏集前缀 + 过滤条件),防止调用方漏拼其中一半。
 * 需要 JOIN/聚合的查询再用裸的 hiddenCtes + visibleCond 组合。
 */
export function selectVisibleSql(table: string, tail = ''): string {
  return `${hiddenCtes(table)} SELECT * FROM "${table}" WHERE ${visibleCond(table)} ${tail}`.trim()
}

export async function fetchRowById(
  db: SoftDb,
  table: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  assertBusinessTable(table)
  const rows = await db.select<Record<string, unknown>>(
    `SELECT * FROM "${table}" WHERE id = ?`,
    [id],
  )
  return rows[0] ?? null
}

export type OperationAction = 'create' | 'update' | 'delete' | 'restore'

export interface OperationLogInput {
  table: string
  recordId: string
  action: OperationAction
  /** 操作前快照(create 无) */
  before?: Record<string, unknown> | null
  /** 操作后快照；旧版 delete 日志可能为空 */
  after?: Record<string, unknown> | null
  operator?: string
}

/** 落一条操作日志,返回日志 id(撤回句柄)。created_at 显式写毫秒级 ISO,同秒多条日志仍可按时间排序 */
export async function logOperation(db: SoftDb, input: OperationLogInput): Promise<string> {
  const id = generateId('oplog')
  await db.execute(
    `INSERT INTO operation_logs (id, table_name, record_id, action, before_data, after_data, operator, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.table,
      input.recordId,
      input.action,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      input.operator ?? '',
      new Date().toISOString(),
    ],
  )
  return id
}

/**
 * 新增落账:INSERT 之后调用,取整行快照落 create 日志。
 * @returns 日志 id;行不存在(INSERT 未生效)返回 null 且不落日志
 */
export async function logCreate(db: SoftDb, table: string, id: string, operator = ''): Promise<string | null> {
  const after = await fetchRowById(db, table, id)
  if (!after)
    return null
  return logOperation(db, { table, recordId: id, action: 'create', after, operator })
}

/**
 * 编辑落账三明治:before 快照 → 执行写入 → after 快照 → update 日志。
 * 记录不存在(或已被删)时不执行写入、不落日志(防幽灵日志),返回 null。
 */
export async function withUpdateLog(
  db: SoftDb,
  table: string,
  id: string,
  mutate: () => Promise<void>,
  operator = '',
): Promise<string | null> {
  const before = await fetchRowById(db, table, id)
  if (!before || before.deleted_at != null)
    return null
  await mutate()
  const after = await fetchRowById(db, table, id)
  return logOperation(db, { table, recordId: id, action: 'update', before, after, operator })
}

/**
 * 软删除:只打 deleted_at 标记,不执行 DELETE;落 delete 日志(含删除前快照)。
 * 级联口径(ADR 0003):只标父级,不逐条标记子记录——子级靠查询「祖先未删」过滤隐藏。
 * @returns 日志 id;记录不存在或已删除返回 null(幂等)
 */
export async function softDelete(
  db: SoftDb,
  table: string,
  id: string,
  operator = '',
): Promise<string | null> {
  const before = await fetchRowById(db, table, id)
  if (!before || before.deleted_at != null)
    return null
  const deletedAt = new Date().toISOString()
  await db.execute(`UPDATE "${table}" SET deleted_at = ? WHERE id = ?`, [deletedAt, id])
  const after = { ...before, deleted_at: deletedAt }
  return logOperation(db, { table, recordId: id, action: 'delete', before, after, operator })
}

/**
 * 恢复:清 deleted_at;落 restore 日志(含恢复后快照)。
 * 恢复父级即整串重现(子级从未被标记);删父前已单删的子记录保持删除态。
 * @returns 日志 id;记录不存在或未删除返回 null(幂等)
 */
export async function restoreRecord(
  db: SoftDb,
  table: string,
  id: string,
  operator = '',
): Promise<string | null> {
  const row = await fetchRowById(db, table, id)
  if (!row || row.deleted_at == null)
    return null
  await db.execute(`UPDATE "${table}" SET deleted_at = NULL WHERE id = ?`, [id])
  // 本次只改了一列,快照本地合成,省一次回查
  const after = { ...row, deleted_at: null }
  return logOperation(db, { table, recordId: id, action: 'restore', after, operator })
}

interface OperationLogRow {
  sequence: number
  id: string
  table_name: string
  record_id: string
  action: OperationAction
  before_data: string | null
  after_data: string | null
}

function snapshotMatches(
  current: Record<string, unknown>,
  expected: Record<string, unknown>,
  ignoredKeys: readonly string[] = [],
): boolean {
  const ignored = new Set(ignoredKeys)
  const currentKeys = Object.keys(current).filter(key => !ignored.has(key) && !key.startsWith('__')).sort()
  const expectedKeys = Object.keys(expected).filter(key => !ignored.has(key) && !key.startsWith('__')).sort()
  if (currentKeys.length !== expectedKeys.length || currentKeys.some((key, index) => key !== expectedKeys[index]))
    return false
  return expectedKeys.every(key => JSON.stringify(current[key]) === JSON.stringify(expected[key]))
}

/**
 * 严格撤回：仅当物理行仍等于该日志的“操作后”快照时才反做。
 *
 * 这是需要 CAS 语义的批量撤回专用入口；旧的 undoOperation 保持跨域兼容语义。
 * 历史 delete 日志可能没有 after_data，因此兼容为“当前仍已删除，且其余列等于 before”。
 */
export async function undoOperationIfUnchanged(db: SoftDb, logId: string, operator = ''): Promise<boolean> {
  const [log] = await db.select<OperationLogRow>(
    'SELECT rowid AS sequence, * FROM operation_logs WHERE id = ?',
    [logId],
  )
  if (!log)
    return false

  try {
    // 防 ABA：即使字段值/毫秒时间戳绕回原样，只要此后落过同记录日志，旧句柄即失效。
    const [newer] = await db.select<{ present: number }>(
      `SELECT 1 AS present
       FROM operation_logs
       WHERE table_name = ? AND record_id = ? AND rowid > ?
       LIMIT 1`,
      [log.table_name, log.record_id, log.sequence],
    )
    if (newer)
      return false
    const current = await fetchRowById(db, log.table_name, log.record_id)
    if (!current)
      return false
    if (log.after_data) {
      const after = JSON.parse(log.after_data) as Record<string, unknown>
      if (!snapshotMatches(current, after))
        return false
    }
    else {
      if (log.action !== 'delete' || !log.before_data || current.deleted_at == null)
        return false
      const before = JSON.parse(log.before_data) as Record<string, unknown>
      if (!snapshotMatches(current, before, ['deleted_at']))
        return false
    }
  }
  catch {
    return false
  }

  return undoOperation(db, logId, operator)
}

/**
 * 撤回:按日志反做(DATABASE.md §8.3)——删除→恢复、新增/恢复→软删除、编辑→回写 before_data;
 * 反做本身落补偿日志。撤回时效(10 秒 undoToast)是 UI 责任,数据层不限时。
 * @returns 是否实际执行了反做
 */
export async function undoOperation(db: SoftDb, logId: string, operator = ''): Promise<boolean> {
  const [log] = await db.select<OperationLogRow>(
    'SELECT * FROM operation_logs WHERE id = ?',
    [logId],
  )
  if (!log)
    return false
  const { table_name: table, record_id: id } = log
  switch (log.action) {
    case 'delete':
      return (await restoreRecord(db, table, id, operator)) != null
    case 'create':
    case 'restore':
      return (await softDelete(db, table, id, operator)) != null
    case 'update': {
      if (!log.before_data)
        return false
      const current = await fetchRowById(db, table, id)
      if (!current)
        return false
      // 坏日志(损坏 JSON / 非法列名 / 快照含已被后续迁移移除的列)一律优雅拒绝,不抛穿到 UI
      try {
        const before = JSON.parse(log.before_data) as Record<string, unknown>
        // 生死状态只走 delete/restore 通道:回写编辑不得复活/再删记录,故排除 deleted_at
        const cols = Object.keys(before).filter(c => c !== 'id' && c !== 'deleted_at' && !c.startsWith('__'))
        if (!cols.length)
          return false
        cols.forEach(assertIdentifier)
        await db.execute(
          `UPDATE "${table}" SET ${cols.map(c => `"${c}" = ?`).join(', ')} WHERE id = ?`,
          [...cols.map(c => before[c]), id],
        )
        await logOperation(db, { table, recordId: id, action: 'update', before: current, after: before, operator })
        return true
      }
      catch {
        return false
      }
    }
    default:
      return false
  }
}

export interface DownstreamCount {
  table: string
  n: number
}

/** parentTable 的直接子表清单(以任意列指向 parentTable 的表,含自引用,如 suppliers→suppliers)。 */
function childTablesOf(parentTable: string): { table: string, column: string }[] {
  const result: { table: string, column: string }[] = []
  for (const [table, refs] of Object.entries(PARENT_REFS)) {
    for (const ref of refs) {
      if (ref.table === parentTable)
        result.push({ table, column: ref.column })
    }
  }
  return result
}

/**
 * 通用下游杀伤统计(ADR 0003 cascade 确认清单):从权威登记 PARENT_REFS 反推「以任意列指向
 * parentTable」的子表(含自引用——hiddenCtes/visibleCond 对自引用表走真实递归级联,此层不代为
 * 假设"自引用=无杀伤"),对每张子表按软删层可见性口径(hiddenCtes+visibleCond)在「应用可见集」中
 * 并行计数——不把已因兄弟祖先被删而隐藏的记录计入,与列表页口径一致。只含 n>0 的项,空数组=无下游
 * (驱动 UI 走 simple 而非 cascade 确认)。
 * 各 store 按自身展示需要把 {table,n} 映射为 { label, n }(ConfirmImpact),标签映射与「本域是否要
 * 展示某张子表」的业务判断(如分供方域排除 suppliers 自引用——该域无母子挂靠,见 stores/supplier.ts)
 * 都不进此层,只在调用方按域定制,避免把单一领域的事实认定焊死进domain-agnostic 的共享层。
 */
export async function downstreamImpact(db: SoftDb, parentTable: string, id: string): Promise<DownstreamCount[]> {
  assertBusinessTable(parentTable)
  const children = childTablesOf(parentTable)
  const counts = await Promise.all(children.map(async ({ table, column }) => {
    const [row] = await db.select<{ n: number }>(
      `${hiddenCtes(table)} SELECT COUNT(*) AS n FROM "${table}" WHERE ${visibleCond(table)} AND "${table}"."${column}" = ?`,
      [id],
    )
    return { table, n: row?.n ?? 0 }
  }))
  return counts.filter(c => c.n > 0)
}

export interface SoftDeleteActions {
  /** 软删除(ADR 0003 只标父级);返回操作日志 id 作单条删除的撤回句柄。级联交互(打名+预提交挂起)见 ADR 0003/#76,不走此撤回 */
  remove: (id: string) => Promise<string | null>
  restore: (id: string) => Promise<string | null>
  /** 按操作日志 id 撤回(删除→恢复、新增→软删、编辑→回写) */
  undo: (logId: string) => Promise<boolean>
}

/**
 * store 软删三连工厂:remove/restore/undo + 成功后重载列表。
 * 各 store 一行展开,避免逐店复制同一套仪式代码。
 */
export function createSoftDeleteActions(
  db: SoftDb,
  table: string,
  reload: () => Promise<void>,
): SoftDeleteActions {
  assertBusinessTable(table)
  return {
    async remove(id: string) {
      const logId = await softDelete(db, table, id)
      await reload()
      return logId
    },
    async restore(id: string) {
      const logId = await restoreRecord(db, table, id)
      await reload()
      return logId
    },
    async undo(logId: string) {
      const ok = await undoOperation(db, logId)
      if (ok)
        await reload()
      return ok
    },
  }
}
