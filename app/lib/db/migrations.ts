import { ALL_SCHEMA } from './schema'

/** 迁移器依赖的最小驱动形状（connection.ts 的 DbDriver 结构兼容，测试可用 sql.js 内存库实现） */
export interface MigrationDb {
  execute(sql: string, params?: unknown[]): Promise<void>
  select<T>(sql: string, params?: unknown[]): Promise<T[]>
}

export interface Migration {
  version: number
  name: string
  up(db: MigrationDb): Promise<void>
}

export interface MigrateResult {
  from: number
  to: number
  applied: string[]
}

/** 与现有 connection.ts 相同的拆句语义：按分号拆分（schema 内不含字符串分号） */
export function splitStatements(sql: string): string[] {
  return sql.split(';').map(s => s.trim()).filter(Boolean)
}

export async function execScript(db: MigrationDb, sql: string): Promise<void> {
  for (const stmt of splitStatements(sql)) {
    await db.execute(`${stmt};`)
  }
}

export function assertIdentifier(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`[db] 非法标识符: ${name}`)
  }
}

/**
 * 给存量表补列（幂等）：列已存在则跳过。
 * ALTER 类迁移一律经由此 helper，重复执行/半途重跑都安全。
 * @returns 是否真正执行了 ALTER
 */
export async function addColumnIfMissing(
  db: MigrationDb,
  table: string,
  column: string,
  ddl: string,
): Promise<boolean> {
  assertIdentifier(table)
  assertIdentifier(column)
  const cols = await db.select<{ name: string }>(
    'SELECT name FROM pragma_table_info(?)',
    [table],
  )
  if (cols.some(c => c.name === column)) return false
  await db.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl};`)
  return true
}

/** v2 补列的业务表清单——迁移是历史事实,冻结快照,后续新表在各自迁移里自带 deleted_at */
const V2_TABLES = [
  'projects', 'suppliers', 'invoices', 'crews',
  'supplier_credentials', 'project_suppliers', 'phase_tasks',
  'construction_contracts', 'owner_change_orders', 'expenditure_contracts',
  'invoice_applications', 'receipt_registrations', 'current_receipts',
  'current_payments', 'payment_records', 'workers',
  'settlements', 'supplement_agreements', 'contract_line_items',
  'ticket_registrations', 'payment_applications', 'file_refs',
]

/** 操作日志表(DATABASE.md §8.2) */
const V2_OPERATION_LOGS = `
CREATE TABLE IF NOT EXISTS operation_logs (
  id          TEXT PRIMARY KEY,
  table_name  TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  before_data TEXT,
  after_data  TEXT,
  operator    TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_operation_logs_record ON operation_logs(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_time ON operation_logs(created_at);
`

/**
 * 全部迁移，按 version 升序执行。新增 schema 变更 = 追加一个更高 version 的条目。
 * v1 为基线：全量建表（全部 IF NOT EXISTS），对「已有表但无版本记录」的存量库同样收敛。
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'baseline-full-schema',
    async up(db) {
      await execScript(db, ALL_SCHEMA)
    },
  },
  {
    version: 2,
    name: 'soft-delete-operation-logs',
    async up(db) {
      for (const t of V2_TABLES) {
        await addColumnIfMissing(db, t, 'deleted_at', 'TEXT DEFAULT NULL')
        // 部分索引:已删记录天然稀少,隐藏集 CTE 的基础臂从全表扫描降为 O(已删数)
        await db.execute(
          `CREATE INDEX IF NOT EXISTS idx_${t}_deleted ON "${t}"(deleted_at) WHERE deleted_at IS NOT NULL;`,
        )
      }
      // 自引用递归 CTE(hidden_suppliers)按父列查找,补索引
      await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_suppliers_parent ON suppliers(parent_supplier_id);',
      )
      await execScript(db, V2_OPERATION_LOGS)
    },
  },
]

export const LATEST_VERSION = migrations.reduce((max, m) => Math.max(max, m.version), 0)

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now'))
);`

export async function getCurrentVersion(db: MigrationDb): Promise<number> {
  await db.execute(MIGRATIONS_TABLE)
  const rows = await db.select<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')
  return rows[0]?.v ?? 0
}

/**
 * 启动时调用：检测当前版本，按序执行缺失迁移并逐个记录版本。
 * 已在最新版本时不做任何事（幂等）。
 */
export async function runMigrations(
  db: MigrationDb,
  list: Migration[] = migrations,
): Promise<MigrateResult> {
  const versions = new Set<number>()
  for (const m of list) {
    if (versions.has(m.version)) {
      throw new Error(`[db] 迁移版本号重复: v${m.version}`)
    }
    versions.add(m.version)
  }

  const from = await getCurrentVersion(db)
  const pending = [...list].sort((a, b) => a.version - b.version).filter(m => m.version > from)

  const applied: string[] = []
  for (const m of pending) {
    await m.up(db)
    await db.execute('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name])
    applied.push(`v${m.version} ${m.name}`)
  }

  const to = applied.length ? await getCurrentVersion(db) : from
  if (applied.length) {
    console.info(`[db] schema 迁移 v${from} → v${to}: ${applied.join(', ')}`)
  }
  return { from, to, applied }
}
