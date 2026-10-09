import type { TransactionDb } from '../db/coordinator'
import { quantityProblem } from './central-contract'

/** Call only after the owning provider has verified these selected identities; this is an FK locator, never an upstream. */
export async function ensureQuantityExternalReferences(tx: TransactionDb, selected: { contracts?: readonly { id: string, projectId: string }[], lines?: readonly { id: string, projectId: string, contractId: string }[] }, fail: (message: string) => never = (message) => {
  throw quantityProblem('conflict', message)
}) {
  for (const row of selected.contracts ?? []) {
    const prior = (await tx.select<{ project_id: string }>('SELECT project_id FROM quantity_contract_references WHERE id=?', [row.id]))[0]
    if (prior && prior.project_id !== row.projectId)
      fail('原施工引用定位属于其他项目，不能覆盖已有确认')
    if (!prior)
      await tx.execute('INSERT INTO quantity_contract_references(id,project_id) VALUES (?,?)', [row.id, row.projectId])
  }
  for (const row of selected.lines ?? []) {
    const prior = (await tx.select<{ project_id: string, contract_id: string }>('SELECT project_id,contract_id FROM quantity_boq_references WHERE id=?', [row.id]))[0]
    if (prior && (prior.project_id !== row.projectId || prior.contract_id !== row.contractId))
      fail('原清单引用定位属于其他项目或合同，不能覆盖已有确认')
    if (!prior)
      await tx.execute('INSERT INTO quantity_boq_references(id,project_id,contract_id) VALUES (?,?,?)', [row.id, row.projectId, row.contractId])
  }
}
