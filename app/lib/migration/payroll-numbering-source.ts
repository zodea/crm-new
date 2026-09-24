import type { SoftDb } from '../db/soft-delete'
import type { PayrollJsonObject } from '../payroll/central-contract'
import type { PayrollNumberingTable } from '../payroll/central-numbering-schema'
import type { PayrollMigrationRow } from './payroll-source'
import { numberingExact, numberingObject, officialNumber, officialNumberText } from '../payroll/central-numbering-codec'
import { PAYROLL_NUMBERING_COLUMNS, PAYROLL_NUMBERING_TABLES } from '../payroll/central-numbering-schema'

export interface PayrollNumberingMigrationGraph extends PayrollJsonObject { schemaVersion: 1, tables: Record<PayrollNumberingTable, PayrollMigrationRow[]> }
function invalid(message: string): never {
  throw new Error(`工资迁移：正式编号${message}`)
}
export function parsePayrollNumberingMigrationGraph(value: unknown): PayrollNumberingMigrationGraph {
  if (!numberingObject(value) || !numberingExact(value, ['schemaVersion', 'tables']) || value.schemaVersion !== 1 || !numberingObject(value.tables) || !numberingExact(value.tables, PAYROLL_NUMBERING_TABLES))
    invalid('原图结构无效')
  const tables = {} as PayrollNumberingMigrationGraph['tables']
  for (const table of PAYROLL_NUMBERING_TABLES) {
    const rows = value.tables[table]
    if (!Array.isArray(rows))
      invalid(`缺少 ${table}`)
    const ids = new Set<string>()
    const columns: readonly string[] = PAYROLL_NUMBERING_COLUMNS[table]
    tables[table] = rows.map((row) => {
      if (!numberingObject(row) || !numberingExact(row, [...columns]) || typeof row.id !== 'string' || !row.id || ids.has(row.id)
        || typeof row.project_id !== 'string' || !row.project_id || columns.some(column => !['string', 'number'].includes(typeof row[column]))) {
        invalid(`${table}字段或稳定身份无效`)
      }
      ids.add(row.id)
      const number = table === 'payroll_numbering_settings' ? row.next_number : Number(row.official_number)
      if (!officialNumber(number) || (table === 'payroll_official_issues' && !officialNumberText(row.official_number)) || (table === 'payroll_numbering_settings' && (!officialNumber(row.first_number) || number < row.first_number)))
        invalid(`${table}序号无效，不能猜号修复`)
      return Object.fromEntries(columns.map(column => [column, row[column]])) as PayrollMigrationRow
    })
  }
  const settings = tables.payroll_numbering_settings
  if (new Set(settings.map(row => row.project_id)).size !== settings.length)
    invalid('项目起点重复，须先人工核对')
  const issues = tables.payroll_official_issues
  if (new Set(issues.map(row => row.statement_id)).size !== issues.length || new Set(issues.map(row => JSON.stringify([row.project_id, Number(row.official_number)]))).size !== issues.length)
    invalid('旧号或原工资重复，须先人工核对，不能择一保留或重新占号')
  for (const row of issues) {
    const current = settings.find(setting => setting.project_id === row.project_id)
    if (!current || Number(row.official_number) < Number(current.first_number) || Number(row.official_number) >= Number(current.next_number))
      invalid('旧号与原登记序列不一致，须先人工核对')
  }
  return { schemaVersion: 1, tables }
}
export async function readPayrollNumberingMigrationGraph(db: Pick<SoftDb, 'select'>): Promise<PayrollNumberingMigrationGraph | undefined> {
  const names = new Set((await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')).map(row => row.name))
  if (!PAYROLL_NUMBERING_TABLES.some(table => names.has(table)))
    return undefined
  const tables = {} as PayrollNumberingMigrationGraph['tables']
  for (const table of PAYROLL_NUMBERING_TABLES) {
    if (!names.has(table))
      invalid(`缺少 ${table}，不能部分导出`)
    tables[table] = await db.select<PayrollMigrationRow>(`SELECT ${PAYROLL_NUMBERING_COLUMNS[table].join(',')} FROM ${table} ORDER BY id`)
  }
  return parsePayrollNumberingMigrationGraph({ schemaVersion: 1, tables })
}
