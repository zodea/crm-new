import type { TransactionDb } from '../db/coordinator'
import { quantityProblem } from './central-contract'

export const QUANTITY_HOLLOW_SCHEMA_VERSION = 1 as const
/** 五表及原 JSON 的唯一运输白名单；不改写原文以适配迁入身份。 */
export const QUANTITY_HOLLOW_COLUMNS = {
  quantity_hollow_records: ['id', 'project_id', 'unit_id', 'assignment_id', 'room_id', 'item_id', 'ownership_key', 'original_party_json', 'location_json', 'responsibility_proof_json', 'responsibility_fingerprint', 'created_at', 'created_by', 'command_receipt_id'],
  quantity_hollow_revisions: ['id', 'record_id', 'previous_revision_id', 'inspected_on', 'count', 'note', 'reason', 'created_at', 'created_by', 'command_receipt_id'],
  quantity_hollow_rectifications: ['id', 'record_id', 'revision_id', 'rectified_on', 'count', 'note', 'created_at', 'created_by', 'command_receipt_id'],
  quantity_hollow_logs: ['id', 'project_id', 'record_id', 'previous_log_id', 'kind', 'revision_id', 'rectification_id', 'payload_json', 'payload_fingerprint', 'created_at', 'actor_id', 'command_receipt_id'],
  quantity_hollow_command_receipts: ['id', 'workspace_id', 'actor_id', 'command_id', 'project_id', 'unit_id', 'record_id', 'kind', 'request_json', 'request_fingerprint', 'result_json', 'result_fingerprint', 'created_at'],
} as const
export type QuantityHollowTable = keyof typeof QUANTITY_HOLLOW_COLUMNS
export type QuantityHollowRow = Record<string, string | number | null>
export type QuantityHollowTables = Record<QuantityHollowTable, QuantityHollowRow[]>
export const QUANTITY_HOLLOW_TABLES = Object.keys(QUANTITY_HOLLOW_COLUMNS) as QuantityHollowTable[]
export const QUANTITY_HOLLOW_PRIMARY_KEYS = Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, 'id'])) as Record<QuantityHollowTable, 'id'>

/** 首次原责任采集的固定字段；不保存工资或联系方式。 */
export const QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS = {
  projects: ['id', 'name', 'code', 'deleted_at'],
  buildings: ['id', 'project_id', 'name', 'deleted_at'],
  floors: ['id', 'building_id', 'name', 'deleted_at'],
  units: ['id', 'floor_id', 'house_type_template_id', 'code', 'name', 'deleted_at'],
  house_type_templates: ['id', 'project_id', 'name', 'deleted_at'],
  rooms: ['id', 'template_id', 'name', 'deleted_at'],
  items: ['id', 'project_id', 'name', 'trade', 'deleted_at'],
  house_type_template_items: ['id', 'room_id', 'item_id', 'deleted_at'],
  unit_assignments: ['id', 'unit_id', 'trade', 'worker_id', 'crew_id', 'deleted_at'],
  unit_assignment_scopes: ['id', 'assignment_id', 'room_id', 'item_id', 'deleted_at'],
  workers: ['id', 'name', 'trade', 'deleted_at'],
  crews: ['id', 'name', 'trade', 'deleted_at'],
  operation_logs: ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at'],
} as const
export type QuantityHollowResponsibilityTable = keyof typeof QUANTITY_HOLLOW_RESPONSIBILITY_COLUMNS
export type QuantityHollowResponsibilityRows = Record<QuantityHollowResponsibilityTable, QuantityHollowRow[]>

export async function initializeQuantityHollowSchema(db: TransactionDb): Promise<void> {
  if ((await db.select('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'production_metadata\'')).length) {
    const participants = await db.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'quantity\'')
    const names = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_schema WHERE type=\'table\'')).map(row => row.name))
    if (participants.length !== 1 || participants[0]?.schema_version !== QUANTITY_HOLLOW_SCHEMA_VERSION || QUANTITY_HOLLOW_TABLES.some(table => !names.has(table)))
      throw quantityProblem('unavailable', '正式空鼓参与者未完成升级或实表缺失；停止读取，不在读取时补建。')
    return
  }
  const receipt = 'REFERENCES quantity_hollow_command_receipts(id) DEFERRABLE INITIALLY DEFERRED'
  const kinds = '\'create-hollow-inspection\',\'revise-hollow-inspection\',\'rectify-hollow-inspection\''
  await db.execute(`CREATE TABLE IF NOT EXISTS quantity_hollow_records (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), unit_id TEXT NOT NULL REFERENCES units(id),
    assignment_id TEXT NOT NULL REFERENCES unit_assignments(id), room_id TEXT NOT NULL REFERENCES rooms(id), item_id TEXT NOT NULL REFERENCES items(id),
    ownership_key TEXT NOT NULL, original_party_json TEXT NOT NULL, location_json TEXT NOT NULL, responsibility_proof_json TEXT NOT NULL,
    responsibility_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, command_receipt_id TEXT NOT NULL ${receipt})`)
  await db.execute(`CREATE TABLE IF NOT EXISTS quantity_hollow_revisions (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id) DEFERRABLE INITIALLY DEFERRED,
    previous_revision_id TEXT REFERENCES quantity_hollow_revisions(id) DEFERRABLE INITIALLY DEFERRED,
    inspected_on TEXT NOT NULL, count INTEGER NOT NULL CHECK(typeof(count)='integer' AND count>=0 AND count<=9007199254740991),
    note TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL, command_receipt_id TEXT NOT NULL UNIQUE ${receipt})`)
  await db.execute(`CREATE TABLE IF NOT EXISTS quantity_hollow_rectifications (
    id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id), revision_id TEXT NOT NULL REFERENCES quantity_hollow_revisions(id),
    rectified_on TEXT NOT NULL, count INTEGER NOT NULL CHECK(typeof(count)='integer' AND count>0 AND count<=9007199254740991),
    note TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, command_receipt_id TEXT NOT NULL UNIQUE ${receipt})`)
  await db.execute(`CREATE TABLE IF NOT EXISTS quantity_hollow_logs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id),
    previous_log_id TEXT REFERENCES quantity_hollow_logs(id), kind TEXT NOT NULL CHECK(kind IN (${kinds})),
    revision_id TEXT NOT NULL REFERENCES quantity_hollow_revisions(id), rectification_id TEXT REFERENCES quantity_hollow_rectifications(id),
    payload_json TEXT NOT NULL, payload_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, actor_id TEXT NOT NULL, command_receipt_id TEXT NOT NULL UNIQUE ${receipt})`)
  await db.execute(`CREATE TABLE IF NOT EXISTS quantity_hollow_command_receipts (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id), unit_id TEXT NOT NULL REFERENCES units(id), record_id TEXT NOT NULL REFERENCES quantity_hollow_records(id) DEFERRABLE INITIALLY DEFERRED,
    kind TEXT NOT NULL CHECK(kind IN (${kinds})), request_json TEXT NOT NULL, request_fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, result_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(workspace_id,actor_id,command_id))`)
  for (const [table, previous] of [['quantity_hollow_revisions', 'previous_revision_id'], ['quantity_hollow_logs', 'previous_log_id']] as const) {
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_first ON ${table}(record_id) WHERE ${previous} IS NULL`)
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_successor ON ${table}(${previous}) WHERE ${previous} IS NOT NULL`)
  }
}
