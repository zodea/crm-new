import type { TransactionDb } from '../db/coordinator'

/** 仅中央验证实例使用的提交回执和冻结数量，不改变本地历史表。 */
export async function initializeScheduleSchema(db: TransactionDb) {
  await db.execute(`CREATE TABLE IF NOT EXISTS schedule_command_receipts (
    command_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, result_json TEXT NOT NULL)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS schedule_revisions (
    project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0)`)
  await db.execute(`CREATE TABLE IF NOT EXISTS schedule_floor_quantity_snapshots (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL, legacy_missing INTEGER NOT NULL DEFAULT 0)`)
}
