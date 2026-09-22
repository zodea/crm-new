import type { TransactionDb } from '../db/coordinator'
import { logOperation } from '../db/soft-delete'

export function payrollCanonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(payrollCanonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${payrollCanonical(entry)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** 调用表和列只来自领域内部固定动作，不是客户端任意 SQL 能力。 */
export async function payrollWriteRow(db: TransactionDb, table: string, id: string, after: Record<string, unknown>, actor: string): Promise<string> {
  const [before] = await db.select<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=?`, [id])
  const fields = Object.keys(after)
  if (before)
    await db.execute(`UPDATE ${table} SET ${fields.map(field => `${field}=?`).join(',')} WHERE id=?`, [...Object.values(after), id])
  else
    await db.execute(`INSERT INTO ${table}(id,${fields.join(',')}) VALUES (?,${fields.map(() => '?').join(',')})`, [id, ...Object.values(after)])
  return logOperation(db, { table, recordId: id, action: before ? 'update' : 'create', before, after: { ...(before ?? {}), id, ...after }, operator: actor })
}
