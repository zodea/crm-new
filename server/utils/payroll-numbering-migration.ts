import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { PayrollNumberingMigrationGraph } from '../../app/lib/migration/payroll-numbering-source'
import type { PayrollMigrationRow } from '../../app/lib/migration/payroll-source'
import type { PayrollIdentityMapping } from '../../app/lib/payroll/central-contract'
import { parsePayrollNumberingMigrationGraph } from '../../app/lib/migration/payroll-numbering-source'
import { payrollProblem } from '../../app/lib/payroll/central-contract'
import { initializePayrollNumberingSchema, PAYROLL_NUMBERING_COLUMNS, PAYROLL_NUMBERING_TABLES } from '../../app/lib/payroll/central-numbering-schema'
import { payrollNumberingReceiptReferences } from './payroll-numbering-data'

const key = (table: string, id: unknown) => JSON.stringify([table, id])
const references = { project_id: 'projects', statement_id: 'wage_statements', command_id: 'payroll_command_receipts' }
export function mapPayrollNumberingMigrationGraph(source: PayrollNumberingMigrationGraph | undefined, entityId: string, mapping: Map<string, PayrollIdentityMapping>): PayrollNumberingMigrationGraph | undefined {
  if (!source)
    return undefined
  for (const table of PAYROLL_NUMBERING_TABLES) {
    for (const row of source.tables[table]) mapping.set(key(table, row.id), { tableName: table, legacyId: String(row.id), centralId: `${entityId}:${table}:${encodeURIComponent(String(row.id))}` })
  }
  const mapped = (table: string, value: unknown) => {
    const id = mapping.get(key(table, value))?.centralId
    if (!id)
      throw payrollProblem('conflict', `工资迁移：编号 ${table}/${String(value)} 缺少明确身份，不能部分接管`)
    return id
  }
  const tables = {} as PayrollNumberingMigrationGraph['tables']
  for (const table of PAYROLL_NUMBERING_TABLES) tables[table] = source.tables[table].map(row => ({ ...row, id: mapped(table, row.id), ...Object.fromEntries(Object.entries(references).filter(([field]) => Object.hasOwn(row, field)).map(([field, target]) => [field, mapped(target, row[field])])) }))
  return { schemaVersion: 1, tables }
}
export const payrollNumberingGraphKeys = (graph: PayrollNumberingMigrationGraph | undefined) => graph ? PAYROLL_NUMBERING_TABLES.flatMap(table => graph.tables[table].map(row => key(table, row.id))) : []
export const payrollNumberingGraphFingerprint = (graph: PayrollNumberingMigrationGraph | undefined) => graph ? PAYROLL_NUMBERING_TABLES.map(table => [table, graph.tables[table].toSorted((a, b) => String(a.id).localeCompare(String(b.id))).map(row => PAYROLL_NUMBERING_COLUMNS[table].map(column => row[column]))]) : null
export async function readPayrollNumberingMigrationRows(tx: TransactionDb): Promise<PayrollNumberingMigrationGraph> {
  await initializePayrollNumberingSchema(tx)
  const tables = {} as PayrollNumberingMigrationGraph['tables']
  for (const table of PAYROLL_NUMBERING_TABLES) tables[table] = await tx.select<PayrollMigrationRow>(`SELECT ${PAYROLL_NUMBERING_COLUMNS[table].join(',')} FROM ${table} ORDER BY id`)
  return parsePayrollNumberingMigrationGraph({ schemaVersion: 1, tables })
}
export async function insertPayrollNumberingMigrationRows(tx: TransactionDb, graph: PayrollNumberingMigrationGraph | undefined) {
  if (!graph)
    return
  await initializePayrollNumberingSchema(tx)
  for (const table of PAYROLL_NUMBERING_TABLES) {
    const columns = PAYROLL_NUMBERING_COLUMNS[table]
    for (const row of graph.tables[table]) await tx.execute(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(column => row[column]))
  }
}
export async function removePayrollNumberingMigrationRows(tx: TransactionDb, graph: PayrollNumberingMigrationGraph | undefined) {
  if (!graph)
    return
  for (const table of [...PAYROLL_NUMBERING_TABLES].reverse()) {
    for (const row of graph.tables[table]) await tx.execute(`DELETE FROM ${table} WHERE id=?`, [row.id])
  }
}
/** 只追踪明确编号关系；金额、证据文本或不相关项目不会被当作外键。 */
export async function payrollNumberingMigrationReferences(tx: TransactionDb, inheritedReceipts: ReadonlySet<string> = new Set()): Promise<Set<string>> {
  const refs = new Set<string>()
  const add = (table: string, id: unknown) => {
    if (typeof id === 'string' && id)
      refs.add(key(table, id))
  }
  const tables = new Set((await tx.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  for (const table of PAYROLL_NUMBERING_TABLES) {
    if (!tables.has(table))
      continue
    for (const row of await tx.select<Record<string, unknown>>(`SELECT * FROM ${table}`)) {
      for (const [field, target] of Object.entries(references)) add(target, row[field])
    }
  }
  for (const row of await tx.select<Record<string, unknown>>('SELECT * FROM payroll_command_receipts WHERE action IN (\'numbering-initialize\',\'numbering-issue\')')) {
    add('projects', row.project_id)
    add('wage_statements', row.statement_id)
    if (inheritedReceipts.has(String(row.command_id)))
      continue
    for (const ref of payrollNumberingReceiptReferences(row) ?? []) refs.add(ref)
  }
  return refs
}
