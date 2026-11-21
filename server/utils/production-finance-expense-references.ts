import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { financeFailure } from '../../app/lib/finance/central-contract'
import { expenseConsumptionFingerprint } from '../../app/lib/finance/clearance-verification'
import { readVerifiedOriginalExpense } from '../../app/lib/finance/expense-reference'
import { readExpenseClearanceSource } from './production-finance-clearance'

async function authorize(tx: TransactionDb, actor: BusinessSession) {
  if (!actor.capabilities.includes('finance-reimbursement:read'))
    financeFailure('forbidden', '当前身份无权读取原费用。')
  const metadata = (await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  const participant = (await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'finance\''))[0]
  if (!metadata || metadata.workspace_id !== actor.workspaceId || metadata.owner_id !== actor.actorId || participant?.schema_version !== 1)
    financeFailure('unavailable', '原费用正式来源不属于当前工作区或尚未接通。')
}
export async function readOriginalExpenseReference(tx: TransactionDb, actor: BusinessSession, id: string, excludedLinkIds?: ReadonlySet<string>) {
  await authorize(tx, actor)
  const expense = await readVerifiedOriginalExpense(tx, id)
  if (!expense)
    return null
  const version = (await tx.select<{ version: number }>('SELECT version FROM finance_versions WHERE kind=\'reimbursement\' AND id=?', [expense.headerId]))[0]
  const source = (await tx.select<{ revision: number }>('SELECT revision FROM finance_revision WHERE singleton=1'))[0]
  if (!version || !source || !Number.isSafeInteger(version.version) || version.version < 1 || !Number.isSafeInteger(source.revision) || source.revision < 0)
    financeFailure('unavailable', '原费用正式记录版本或来源版本缺失。')
  const current = await readExpenseClearanceSource(tx, actor, { ...expense, version: String(version.version), sourceRevision: `finance-${source.revision}` }, excludedLinkIds)
  // Metadata versions and old frozen proofs remain literal. New adoption gates
  // only the selected original identity/amount and the eligibility it consumes.
  const consumptionVersion = `expense-consumption-v1:${createHash('sha256').update(expenseConsumptionFingerprint(current)).digest('hex')}`
  return { ...current, consumptionVersion }
}
export async function listOriginalExpenseReferences(tx: TransactionDb, actor: BusinessSession, projectId?: string | null) {
  await authorize(tx, actor)
  const rows = await tx.select<{ id: string }>(`SELECT line.id FROM expense_reimbursement_lines line JOIN expense_reimbursements head ON head.id=line.reimbursement_id
    WHERE line.deleted_at IS NULL AND head.deleted_at IS NULL AND head.status='confirmed' AND line.original_expense_line_id IS NULL
    ${projectId === undefined ? '' : 'AND head.project_id IS ?'} ORDER BY line.id`, projectId === undefined ? [] : [projectId])
  const result = []
  for (const row of rows) {
    const reference = await readOriginalExpenseReference(tx, actor, row.id)
    if (reference)
      result.push(reference)
  }
  return result
}
