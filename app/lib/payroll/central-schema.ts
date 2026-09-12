import type { TransactionDb } from '../db/coordinator'

/** 工资事实复用原八表；本表仅维护中央版本与不可变迁入证据。 */
export async function initializePayrollSchema(tx: TransactionDb) {
  await tx.execute('CREATE TABLE IF NOT EXISTS payroll_revision (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL)')
  await tx.execute('INSERT OR IGNORE INTO payroll_revision(singleton, revision) VALUES (1, 0)')
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_migration_evidence (
    entity_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, batch_id TEXT NOT NULL,
    source_graph_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL, mapping_json TEXT NOT NULL)`)
}
export async function payrollRevision(tx: TransactionDb): Promise<number> {
  const rows = await tx.select<{ revision: number }>('SELECT revision FROM payroll_revision WHERE singleton = 1')
  return rows[0]?.revision ?? 0
}
export async function advancePayrollRevision(tx: TransactionDb): Promise<void> {
  await tx.execute('UPDATE payroll_revision SET revision = revision + 1 WHERE singleton = 1')
}
