import type { SoftDb } from '../db/soft-delete'
import type { PayrollIdentityMapping, PayrollJsonObject } from '../payroll/central-contract'
import type { QuantityHollowMigrationGraph } from '../quantity/hollow-migration-contract'
import type { PayrollMigrationRow } from './payroll-source'
import { parseQuantityHollowMigrationGraph } from '../quantity/hollow-migration-graph'
import { rosterObject } from '../worker-roster/validation'

export const PAYROLL_PUBLICATION_COLUMNS = {
  worker_roster_archives: ['id', 'project_id', 'scope_key', 'version', 'snapshot_json', 'created_at'],
  worker_roster_receipts: ['command_id', 'workspace_id', 'actor_id', 'fingerprint', 'result_json', 'worker_id', 'archive_id'],
  payroll_workbook_archives: ['id', 'project_id', 'scope_key', 'version', 'snapshot_json', 'snapshot_hash', 'created_at', 'created_by'],
  payroll_workbook_receipts: ['command_id', 'workspace_id', 'actor_id', 'project_id', 'fingerprint', 'command_json', 'result_json', 'archive_id'],
  payroll_workbook_references: ['archive_id', 'table_name', 'record_id'],
} as const
export type PayrollPublicationTable = keyof typeof PAYROLL_PUBLICATION_COLUMNS
export type PublicationArchiveTable = 'worker_roster_archives' | 'payroll_workbook_archives'
export interface PayrollPublicationOrigin extends PayrollJsonObject {
  tableName: PublicationArchiveTable
  recordId: string
  sourceRow: PayrollMigrationRow
  receiptRow: PayrollMigrationRow
  mappings: Array<PayrollIdentityMapping & PayrollJsonObject>
  quantity: (QuantityHollowMigrationGraph & PayrollJsonObject) | null
  proofHash: string
}
export interface PayrollPublicationGraph extends PayrollJsonObject { schemaVersion: 1, tables: Record<PayrollPublicationTable, PayrollMigrationRow[]>, origins: PayrollPublicationOrigin[] }
export const PAYROLL_PUBLICATION_TABLES = Object.keys(PAYROLL_PUBLICATION_COLUMNS) as PayrollPublicationTable[]
export const publicationRowId = (table: PayrollPublicationTable, row: PayrollMigrationRow) => String(table.endsWith('_receipts') ? JSON.stringify([row.workspace_id, row.actor_id, row.command_id]) : table === 'payroll_workbook_references' ? JSON.stringify([row.archive_id, row.table_name, row.record_id]) : row.id)
function invalid(): never {
  throw new Error('工资目录与固定名册的完整迁移图无效')
}

export function parsePayrollPublicationGraph(raw: unknown): PayrollPublicationGraph {
  if (!rosterObject(raw) || raw.schemaVersion !== 1 || !rosterObject(raw.tables) || !Array.isArray(raw.origins)
    || Object.keys(raw).length !== 3 || Object.keys(raw.tables).length !== PAYROLL_PUBLICATION_TABLES.length) {
    invalid()
  }
  const tables = {} as PayrollPublicationGraph['tables']
  for (const table of PAYROLL_PUBLICATION_TABLES) {
    const rows = raw.tables[table]
    const columns: readonly string[] = PAYROLL_PUBLICATION_COLUMNS[table]
    if (!Array.isArray(rows))
      invalid()
    const ids = new Set<string>()
    tables[table] = rows.map((row) => {
      if (!rosterObject(row) || columns.some(column => !Object.hasOwn(row, column)) || Object.keys(row).some(column => !columns.includes(column))
        || Object.values(row).some(value => value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))) {
        invalid()
      }
      const value = row as PayrollMigrationRow
      const id = publicationRowId(table, value)
      if (!id || id === 'null' || ids.has(id))
        invalid()
      ids.add(id)
      return { ...value }
    })
  }
  const origins = raw.origins.map((value) => {
    if (!rosterObject(value) || Object.keys(value).length !== 7 || !['worker_roster_archives', 'payroll_workbook_archives'].includes(String(value.tableName)) || typeof value.recordId !== 'string'
      || !rosterObject(value.sourceRow) || !rosterObject(value.receiptRow) || !Array.isArray(value.mappings) || !/^[a-f0-9]{64}$/.test(String(value.proofHash))) {
      invalid()
    }
    if (value.quantity !== null)
      parseQuantityHollowMigrationGraph(value.quantity)
    const keys = new Set<string>()
    for (const mapping of value.mappings) {
      if (!rosterObject(mapping) || Object.keys(mapping).length !== 3 || typeof mapping.tableName !== 'string' || typeof mapping.legacyId !== 'string' || !(mapping.centralId === null || typeof mapping.centralId === 'string'))
        invalid()
      const key = JSON.stringify([mapping.tableName, mapping.legacyId])
      if (keys.has(key))
        invalid()
      keys.add(key)
    }
    if (!tables[value.tableName as PublicationArchiveTable].some(row => row.id === value.recordId))
      invalid()
    return value as unknown as PayrollPublicationOrigin
  })
  if (new Set(origins.map(value => JSON.stringify([value.tableName, value.recordId]))).size !== origins.length)
    invalid()
  return { schemaVersion: 1, tables, origins }
}

export function publicationRowProject(table: PayrollPublicationTable, row: PayrollMigrationRow, graph: PayrollPublicationGraph): string | null {
  if (typeof row.project_id === 'string')
    return row.project_id
  const owner = table === 'worker_roster_receipts' ? 'worker_roster_archives' : 'payroll_workbook_archives'
  return String(graph.tables[owner].find(archive => archive.id === row.archive_id)?.project_id ?? '') || null
}

export async function readPayrollPublicationGraph(db: Pick<SoftDb, 'select'>): Promise<PayrollPublicationGraph | null> {
  const names = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  if (!names.has('worker_roster_archives') && !names.has('payroll_workbook_archives'))
    return null
  const tables = {} as PayrollPublicationGraph['tables']
  for (const table of PAYROLL_PUBLICATION_TABLES) {
    if (!names.has(table)) {
      if ((table.startsWith('worker_roster_') && names.has('worker_roster_archives')) || (table.startsWith('payroll_workbook_') && names.has('payroll_workbook_archives')))
        invalid()
      tables[table] = []
      continue
    }
    tables[table] = await db.select<PayrollMigrationRow>(`SELECT ${PAYROLL_PUBLICATION_COLUMNS[table].join(',')} FROM ${table}${table === 'worker_roster_receipts' ? ' WHERE archive_id IS NOT NULL' : ''}`)
  }
  const origins = names.has('payroll_publication_migration_proofs')
    ? (await db.select<{ proof_json: string }>('SELECT proof_json FROM payroll_publication_migration_proofs ORDER BY table_name,record_id')).map(row => JSON.parse(row.proof_json))
    : []
  const graph = parsePayrollPublicationGraph({ schemaVersion: 1, tables, origins })
  if (PAYROLL_PUBLICATION_TABLES.some(table => graph.tables[table].some(row => !publicationRowProject(table, row, graph))))
    invalid()
  return graph
}
