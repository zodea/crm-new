import type { TransactionDb } from '../db/coordinator'

/** 工资事实复用原八表；本表仅维护中央版本与不可变迁入证据。 */
export async function initializePayrollSchema(tx: TransactionDb) {
  await tx.execute('CREATE TABLE IF NOT EXISTS payroll_revision (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL)')
  await tx.execute('INSERT OR IGNORE INTO payroll_revision(singleton, revision) VALUES (1, 0)')
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_migration_evidence (
    entity_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, batch_id TEXT NOT NULL,
    source_graph_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL, mapping_json TEXT NOT NULL)`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_subject_configs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), crew_id TEXT REFERENCES crews(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id), initial_pay_ratio REAL,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
    UNIQUE(project_id, leader_worker_id))`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_price_revisions (
    id TEXT PRIMARY KEY, price_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
    crew_id TEXT REFERENCES crews(id), leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    item_id TEXT NOT NULL REFERENCES items(id), unit TEXT, mode TEXT NOT NULL,
    worker_id TEXT REFERENCES workers(id), effective_month TEXT NOT NULL, unit_price REAL,
    scope_json TEXT NOT NULL, revision INTEGER NOT NULL, operator_id TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(price_id, revision))`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_statement_sources (
    statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id), project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id), source_json TEXT NOT NULL)`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_command_receipts (
    command_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, project_id TEXT NOT NULL,
    statement_id TEXT, config_scope_json TEXT, action TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL,
    command_json TEXT)`)
  // 旧回执没有保存原提交正文时保留 NULL；不能根据当前单据猜造正文再升格为可验证来源。
  if (!(await tx.select<{ name: string }>('PRAGMA table_info(payroll_command_receipts)')).some(column => column.name === 'command_json'))
    await tx.execute('ALTER TABLE payroll_command_receipts ADD COLUMN command_json TEXT')
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_c1_rate_revisions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), worker_id TEXT NOT NULL REFERENCES workers(id),
    effective_month TEXT NOT NULL, daily_wage REAL, overtime_rate REAL, revision INTEGER NOT NULL,
    operator_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id,worker_id,revision))`)
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_c1_statement_sources (
    statement_id TEXT PRIMARY KEY REFERENCES wage_statements(id), project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id), source_json TEXT NOT NULL)`)
}
export async function payrollRevision(tx: TransactionDb): Promise<number> {
  const rows = await tx.select<{ revision: number }>('SELECT revision FROM payroll_revision WHERE singleton = 1')
  return rows[0]?.revision ?? 0
}
export async function advancePayrollRevision(tx: TransactionDb): Promise<void> {
  await tx.execute('UPDATE payroll_revision SET revision = revision + 1 WHERE singleton = 1')
}
