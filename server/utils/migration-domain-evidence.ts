import type { TransactionDb } from '../../app/lib/db/coordinator'
import { MigrationEvidenceProblem } from './migration-snapshot'

export interface MigrationDomainSelection { table: string, key?: string, keys?: readonly string[], ids: readonly string[] }
export interface MigrationRawRow { legacyId: string, columns: Record<string, { sqliteType: string, exactValue: string | null, rawHex: string | null }> }
interface SourceColumn { cid: number, name: string, type: string, notnull: number, dflt_value: string | null, pk: number, hidden: number }

/** Capture only caller-owned row IDs. SQL values are encoded before a JS number can round an integer. */
export async function captureMigrationDomainRows(source: Pick<TransactionDb, 'select'>, selections: readonly MigrationDomainSelection[]) {
  const rows: Record<string, MigrationRawRow[]> = {}
  const schemas: Record<string, { sql: string, columns: SourceColumn[] }> = {}
  const quoteName = (name: string) => `"${name.replaceAll('"', '""')}"`
  for (const selection of selections) {
    if (Object.hasOwn(rows, selection.table))
      throw new MigrationEvidenceProblem('validation-failed', '本域来源采集表重复，不能混合两个采用范围。')
    const [definition] = await source.select<{ sql: string }>('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=?', [selection.table])
    const columns = await source.select<SourceColumn>(`PRAGMA table_xinfo(${quoteName(selection.table)})`)
    const keys = selection.keys ?? (selection.key ? [selection.key] : [])
    if (!definition?.sql || !columns.length || !keys.length || new Set(keys).size !== keys.length || keys.some(key => !columns.some(column => column.name === key)))
      throw new MigrationEvidenceProblem('validation-failed', '本域来源表或稳定主键尚未成功核对，不能以空集合代替。')
    schemas[selection.table] = { sql: definition.sql, columns }
    rows[selection.table] = []
    const fields = columns.flatMap((column, index) => {
      const name = quoteName(column.name)
      return [`typeof(${name}) AS t${index}`, `CASE typeof(${name}) WHEN 'blob' THEN hex(${name}) WHEN 'real' THEN printf('%!.26g',${name}) ELSE CAST(${name} AS TEXT) END AS v${index}`, `CASE WHEN typeof(${name}) IN ('text','blob') THEN hex(CAST(${name} AS BLOB)) ELSE NULL END AS h${index}`]
    })
    const ids = [...new Set(selection.ids)].sort()
    const identity = keys.length === 1 ? `CAST(${quoteName(keys[0]!)} AS TEXT)` : `json_array(${keys.map(key => `CAST(${quoteName(key)} AS TEXT)`).join(',')})`
    for (let start = 0; start < ids.length; start += 400) {
      const batch = ids.slice(start, start + 400)
      const captured = await source.select<Record<string, string | null>>(`SELECT ${identity} AS legacyId,${fields.join(',')} FROM ${quoteName(selection.table)} WHERE ${identity} IN (${batch.map(() => '?').join(',')}) ORDER BY ${keys.map(quoteName).join(',')}`, batch)
      for (const row of captured) {
        if (typeof row.legacyId !== 'string')
          throw new MigrationEvidenceProblem('validation-failed', '本域稳定主键不是原文本身份。')
        const values = Object.fromEntries(columns.map((column, index) => [column.name, { sqliteType: row[`t${index}`]!, exactValue: row[`v${index}`] ?? null, rawHex: row[`h${index}`] ?? null }]))
        rows[selection.table]!.push({ legacyId: row.legacyId, columns: values })
      }
    }
    if (rows[selection.table]!.length !== ids.length)
      throw new MigrationEvidenceProblem('validation-failed', '本域来源主键集合不完整，不能静默丢行。')
  }
  return { rows, schemas }
}
