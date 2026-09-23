import type { SoftDb } from '../db/soft-delete'
import type { PayrollMigrationRow } from './payroll-source'
import { parsePrivateValues, rosterObject } from '../worker-roster/validation'

export const WORKER_MODERN_COLUMNS = {
  worker_roster_profile_versions: ['worker_id', 'revision', 'values_json', 'created_at', 'actor_id'],
  worker_roster_assets: ['id', 'worker_id', 'file_ref_id', 'sha256', 'created_at', 'legacy_category', 'legacy_deleted_at'],
  worker_roster_receipts: ['command_id', 'workspace_id', 'actor_id', 'fingerprint', 'result_json', 'worker_id', 'archive_id'],
  operation_logs: ['id', 'table_name', 'record_id', 'action', 'before_data', 'after_data', 'operator', 'created_at'],
} as const
export type WorkerModernTable = keyof typeof WORKER_MODERN_COLUMNS
export interface WorkerModernGraph { schemaVersion: 1, workerId: string, tables: Record<WorkerModernTable, PayrollMigrationRow[]> }
function invalid(): never {
  throw new Error('工人现代实名图的字段、原件、版本或回执关系不完整')
}

export function parseWorkerModernGraph(raw: unknown, workerId: string): WorkerModernGraph {
  if (!rosterObject(raw) || raw.schemaVersion !== 1 || raw.workerId !== workerId || !rosterObject(raw.tables)
    || Object.keys(raw).some(key => !['schemaVersion', 'workerId', 'tables'].includes(key)) || Object.keys(raw.tables).length !== 4) {
    invalid()
  }
  const tables = {} as WorkerModernGraph['tables']
  for (const table of Object.keys(WORKER_MODERN_COLUMNS) as WorkerModernTable[]) {
    const rows = raw.tables[table]
    const columns: readonly string[] = WORKER_MODERN_COLUMNS[table]
    if (!Array.isArray(rows))
      invalid()
    const keys = new Set<string>()
    tables[table] = rows.map((row) => {
      if (!rosterObject(row) || columns.some(column => !Object.hasOwn(row, column)) || Object.keys(row).some(column => !columns.includes(column))
        || Object.values(row).some(value => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) || (table === 'operation_logs' ? row.record_id !== workerId || row.table_name !== 'worker_roster_profile_versions' : row.worker_id !== workerId)) {
        invalid()
      }
      const key = table === 'worker_roster_receipts' ? JSON.stringify([row.workspace_id, row.actor_id, row.command_id]) : String(row.id ?? row.revision)
      if (!key || keys.has(key))
        invalid()
      keys.add(key)
      if (table === 'worker_roster_profile_versions') {
        if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || typeof row.created_at !== 'string' || typeof row.actor_id !== 'string')
          invalid()
        parsePrivateValues(JSON.parse(String(row.values_json)))
      }
      if (table === 'worker_roster_assets' && (typeof row.file_ref_id !== 'string' || typeof row.created_at !== 'string' || !(row.sha256 === null || /^[a-f0-9]{64}$/.test(String(row.sha256)))))
        invalid()
      if (table === 'worker_roster_receipts') {
        const result = JSON.parse(String(row.result_json))
        if (row.archive_id !== null || !rosterObject(result) || result.workerId !== workerId || result.archiveId !== null || result.commandId !== row.command_id || !Number.isSafeInteger(result.revision)
          || !/^[a-f0-9]{64}$/.test(String(row.fingerprint))) {
          invalid()
        }
      }
      return { ...row } as PayrollMigrationRow
    })
  }
  for (const row of tables.worker_roster_profile_versions) {
    const values = parsePrivateValues(JSON.parse(String(row.values_json)))
    if ([values.portraitId, values.bankCardId].some(id => id && !tables.worker_roster_assets.some(asset => asset.id === id)))
      invalid()
  }
  for (const row of tables.worker_roster_receipts) {
    if (!tables.worker_roster_profile_versions.some(version => version.revision === JSON.parse(String(row.result_json)).revision))
      invalid()
  }
  return { schemaVersion: 1, workerId, tables }
}

export async function readWorkerModernGraphs(db: Pick<SoftDb, 'select'>): Promise<Map<string, WorkerModernGraph>> {
  const result = new Map<string, WorkerModernGraph>()
  const present = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  const names = Object.keys(WORKER_MODERN_COLUMNS) as WorkerModernTable[]
  if (!names.filter(name => name !== 'operation_logs').some(name => present.has(name)))
    return result
  if (!names.every(name => present.has(name)))
    invalid()
  const all = {} as WorkerModernGraph['tables']
  for (const name of names)
    all[name] = await db.select<PayrollMigrationRow>(`SELECT ${WORKER_MODERN_COLUMNS[name].join(',')} FROM ${name}${name === 'worker_roster_receipts' ? ' WHERE worker_id IS NOT NULL' : name === 'operation_logs' ? ' WHERE table_name=\'worker_roster_profile_versions\'' : ''}`)
  const workers = new Set(names.flatMap(name => all[name].map(row => String(name === 'operation_logs' ? row.record_id : row.worker_id))))
  for (const workerId of workers)
    result.set(workerId, parseWorkerModernGraph({ schemaVersion: 1, workerId, tables: Object.fromEntries(names.map(name => [name, all[name].filter(row => (name === 'operation_logs' ? row.record_id : row.worker_id) === workerId)])) }, workerId))
  return result
}
