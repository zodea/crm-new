import type { MigrationDb } from '~/lib/db/migrations'

/** 同号判断共用数据库事实；归档时已排除的副本不阻塞原票。 */
export async function hasInvoiceDuplicate(db: MigrationDb, id: string, invoiceNumber: string, eligibleOnly = false): Promise<boolean> {
  if (!invoiceNumber.trim())
    return false
  const rows = await db.select<{ id: string }>(
    `SELECT id FROM invoices WHERE TRIM(invoice_number) = ? AND id <> ? AND deleted_at IS NULL
     ${eligibleOnly ? 'AND (account_status = \'archived\' OR dup_status <> \'duplicate\')' : ''} LIMIT 1`,
    [invoiceNumber.trim(), id],
  )
  return rows.length > 0
}
