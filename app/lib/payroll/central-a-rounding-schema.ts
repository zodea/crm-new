import type { TransactionDb } from '../db/coordinator'
import { hasProductionPayrollSchema } from './central-schema'

/** A 取整是按稳定请款簿追加的显式修订；缺记录与明确关闭保持不同。 */
export async function initializePayrollARoundingSchema(tx: TransactionDb): Promise<void> {
  if (await hasProductionPayrollSchema(tx))
    return
  await tx.execute(`CREATE TABLE IF NOT EXISTS payroll_a_rounding_revisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    leader_worker_id TEXT NOT NULL REFERENCES workers(id),
    book_purpose TEXT NOT NULL CHECK(book_purpose IN ('ordinary','management')),
    management_book_id TEXT,
    effective_month TEXT NOT NULL,
    revision INTEGER NOT NULL,
    rule_json TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK((book_purpose='ordinary' AND management_book_id IS NULL) OR (book_purpose='management' AND management_book_id IS NOT NULL))
  )`)
  await tx.execute('CREATE UNIQUE INDEX IF NOT EXISTS payroll_a_rounding_revision_unique ON payroll_a_rounding_revisions(project_id,leader_worker_id,book_purpose,COALESCE(management_book_id,\'\'),revision)')
}
