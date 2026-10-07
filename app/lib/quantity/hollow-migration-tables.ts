import type { SoftDb } from '../db/soft-delete'
import type { QuantityHollowRow, QuantityHollowTables } from './central-hollow-schema'
import { QUANTITY_HOLLOW_COLUMNS, QUANTITY_HOLLOW_TABLES } from './central-hollow-schema'
import { emptyQuantityHollowTables, hollowMigrationInvalid, parseQuantityHollowTables } from './hollow-migration-graph'

/** 全无仍为旧库；部分升级或未知列不可静默忽略。读取保持所有原 JSON 字节。 */
export async function readQuantityHollowTables(db: Pick<SoftDb, 'select'>, options: { captureUnknownColumns?: boolean } = {}): Promise<QuantityHollowTables | null> {
  const schema = await db.select<{ name: string }>('SELECT name FROM sqlite_master WHERE type=\'table\'')
  const names = new Set(schema.map(row => row.name))
  const present = QUANTITY_HOLLOW_TABLES.filter(table => names.has(table))
  if (!present.length)
    return null
  if (present.length !== QUANTITY_HOLLOW_TABLES.length)
    hollowMigrationInvalid('来源只具备部分空鼓表，不能降为旧图')
  const tables = emptyQuantityHollowTables()
  for (const table of QUANTITY_HOLLOW_TABLES) {
    const columns = await db.select<{ name: string }>(`PRAGMA table_info(${table})`)
    const expected: readonly string[] = QUANTITY_HOLLOW_COLUMNS[table]
    if (expected.some(column => !columns.some(actual => actual.name === column)) || (!options.captureUnknownColumns && (columns.length !== expected.length || columns.some(column => !expected.includes(column.name)))))
      hollowMigrationInvalid(`${table}的物理列不符合冻结合同`)
    tables[table] = await db.select<QuantityHollowRow>(`SELECT ${expected.join(', ')} FROM ${table} ORDER BY id`)
  }
  return parseQuantityHollowTables(tables)
}

export function quantityHollowRecordTables(tables: QuantityHollowTables, recordId: string): QuantityHollowTables {
  return Object.fromEntries(QUANTITY_HOLLOW_TABLES.map(table => [table, tables[table].filter(row => (table === 'quantity_hollow_records' ? row.id : row.record_id) === recordId)])) as QuantityHollowTables
}
