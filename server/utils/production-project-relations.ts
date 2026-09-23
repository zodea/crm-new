import type { CustomerProjectSourceRow } from '../../app/lib/customer/read-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { ProjectRow } from './production-project-record'
import { projectDraft } from './production-project-record'

/** Called inside the caller's shared transaction; an absent participant is unavailable, never zero. */
export async function productionCustomerProjects(tx: TransactionDb): Promise<CustomerProjectSourceRow[] | null> {
  if (!(await tx.select('SELECT domain FROM production_participants WHERE domain=\'project\' AND schema_version=1')).length)
    return null
  return (await tx.select<ProjectRow>('SELECT * FROM projects WHERE deleted_at IS NULL')).map((row) => {
    const draft = projectDraft(row)
    return { dataOrigin: 'real', id: row.id, name: row.name, code: row.code, customerId: row.customer_id, secondaryCustomerId: row.secondary_customer_id, permission: 'allowed', status: draft.status || '筹备中', startDate: draft.startDate || null, plannedEnd: draft.plannedEnd || null, manager: draft.manager ?? '' }
  })
}
