import type { TransactionDb } from '../db/coordinator'
import { signatoryProblem } from './contract'

export interface ContractNumberFact {
  owner: string
  id: string
  number: string
  version: string
  occurredAt: string
  formal: boolean
}

export async function contractNumberConflict(tx: TransactionDb, owner: string, id: string | null, number: string): Promise<boolean> {
  if (!number.trim())
    return false
  const rows = await tx.select<{ owner_domain: string, contract_id: string }>('SELECT owner_domain,contract_id FROM contract_number_claims WHERE number=?', [number.trim()])
  return rows.some(row => row.owner_domain !== owner || row.contract_id !== id)
}

/** The caller supplies the same actual database transaction as its contract write. */
export async function recordContractNumber(tx: TransactionDb, fact: ContractNumberFact, options: { enforce: boolean, historyId: string }): Promise<void> {
  const number = fact.number.trim()
  const prior = await tx.select<{ number: string }>('SELECT number FROM contract_number_claims WHERE owner_domain=? AND contract_id=?', [fact.owner, fact.id])
  if (fact.formal && number && (options.enforce || prior[0]?.number !== number) && await contractNumberConflict(tx, fact.owner, fact.id, number))
    return signatoryProblem('validation-failed', '已填写的合同编号与其他正式主合同重复，请核对原编号', 'no')
  if (number)
    await tx.execute('INSERT OR IGNORE INTO contract_number_history VALUES(?,?,?,?,?,?,?)', [options.historyId, fact.owner, fact.id, number, fact.version, fact.occurredAt, fact.formal ? 'formal-fact' : 'draft-evidence'])
  if (!fact.formal)
    return // Saving an edit as a draft does not release a previously established contract's number.
  if (!number) {
    await tx.execute('DELETE FROM contract_number_claims WHERE owner_domain=? AND contract_id=?', [fact.owner, fact.id])
    return
  }
  await tx.execute('INSERT INTO contract_number_claims VALUES(?,?,?,?,?) ON CONFLICT(owner_domain,contract_id) DO UPDATE SET number=excluded.number,version=excluded.version,claimed_at=excluded.claimed_at', [fact.owner, fact.id, number, fact.version, fact.occurredAt])
}
