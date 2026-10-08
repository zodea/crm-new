import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollWorkbookArchive } from '../../app/lib/payroll/central-workbook-contract'
import { createHash } from 'node:crypto'
import { payrollCanonical } from '../../app/lib/payroll/central-command-shared'
import { hasProductionPayrollSchema } from '../../app/lib/payroll/central-schema'

export const workbookHash = (value: unknown) => createHash('sha256').update(payrollCanonical(value)).digest('hex')
export function workbookManifestHash(value: Omit<PayrollWorkbookArchive, 'context' | 'manifestHash'> | PayrollWorkbookArchive) {
  return workbookHash(Object.fromEntries(Object.entries(value).filter(([key]) => !['context', 'manifestHash'].includes(key))))
}
export async function initializePayrollWorkbookSchema(db: TransactionDb) {
  if (await hasProductionPayrollSchema(db))
    return
  await db.execute('CREATE TABLE IF NOT EXISTS payroll_workbook_archives(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope_key TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, migration_batch_id TEXT, UNIQUE(scope_key,version))')
  await db.execute('CREATE TABLE IF NOT EXISTS payroll_workbook_receipts(command_id TEXT NOT NULL, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, project_id TEXT NOT NULL, fingerprint TEXT NOT NULL, command_json TEXT, result_json TEXT, archive_id TEXT, PRIMARY KEY(workspace_id,actor_id,command_id))')
  await db.execute('CREATE TABLE IF NOT EXISTS payroll_workbook_references(archive_id TEXT NOT NULL, table_name TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY(archive_id,table_name,record_id))')
}
