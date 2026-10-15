import type { MigrationDb } from '~/lib/db/migrations'

type Row = Record<string, string | number | null>

/** 按对象键逐行写入旧库原始行，用于以 SQL 固化退役本地写路径曾产出的数据形态。 */
export async function insertRows(db: Pick<MigrationDb, 'execute'>, table: string, rows: readonly Row[]) {
  for (const row of rows) {
    const columns = Object.keys(row)
    await db.execute(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(column => row[column]),
    )
  }
}
