import type { TransactionDb } from '../db/coordinator'

/** 可重置中央实例的预算版本与回执；预算事实仍保存在原业务表。 */
export async function initializeTargetCostSchema(tx: TransactionDb) {
  await tx.execute(`CREATE TABLE IF NOT EXISTS target_cost_revision (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL)`)
  await tx.execute('INSERT OR IGNORE INTO target_cost_revision(singleton, revision) VALUES (1, 0)')
  await tx.execute(`CREATE TABLE IF NOT EXISTS target_cost_command_receipts (
    command_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, target_cost_id TEXT NOT NULL,
    action TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL)`)
}

export async function advanceTargetCostRevision(tx: TransactionDb): Promise<void> {
  await tx.execute('UPDATE target_cost_revision SET revision = revision + 1 WHERE singleton = 1')
}

export async function targetCostRevision(tx: TransactionDb): Promise<number> {
  const rows = await tx.select<{ revision: number }>('SELECT revision FROM target_cost_revision WHERE singleton = 1')
  return rows[0]?.revision ?? 0
}
