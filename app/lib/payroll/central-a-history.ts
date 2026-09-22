import type { TransactionDb } from '../db/coordinator'
import type { PayrollHistoryEntry, PayrollJson } from './central-contract'
import { payrollObject } from './central-snapshot'

function parsed(raw: string | null): PayrollJson | null {
  if (raw === null)
    return null
  try {
    return JSON.parse(raw) as PayrollJson
  }
  catch { return null }
}
export async function loadPayrollAConfigHistory(db: TransactionDb, projectId: string, leaderWorkerId: string | null): Promise<PayrollHistoryEntry[]> {
  const rows = await db.select<{ id: string, table_name: string, record_id: string, action: string, created_at: string | null, operator: string | null, before_data: string | null, after_data: string | null }>('SELECT * FROM operation_logs WHERE table_name IN (\'payroll_a_subject_configs\',\'payroll_a_price_revisions\') ORDER BY created_at,id')
  return rows.flatMap((row) => {
    const beforeData = parsed(row.before_data)
    const afterData = parsed(row.after_data)
    const current = afterData ?? beforeData
    if (!payrollObject(current) || current.project_id !== projectId || current.leader_worker_id !== leaderWorkerId)
      return []
    return [{ id: row.id, tableName: row.table_name, recordId: row.record_id, operation: row.action, operatedAt: row.created_at, operator: row.operator, beforeData, afterData, beforeRaw: row.before_data, afterRaw: row.after_data }]
  })
}
