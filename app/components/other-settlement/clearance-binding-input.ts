import type { ExpenseClearanceLinkEdit } from '~/lib/finance/clearance-verification'
import { isExpenseClearanceLinkEdit } from '~/lib/finance/clearance-verification'

export interface ClearanceBindingInput {
  verificationId: string
  bindings: Array<{ expenseAllocationId: string, itemId: string, amount: string }>
}
export const emptyClearanceBindingInput = (): ClearanceBindingInput => ({ verificationId: '', bindings: [] })
export function clearanceBindingEdit(input: ClearanceBindingInput): ExpenseClearanceLinkEdit | null {
  if (input.bindings.some(row => !/^\d+(?:\.\d+)?$/.test(row.amount)))
    return null
  const value = { verificationId: input.verificationId, bindings: input.bindings.map(row => ({ ...row, amount: Number(row.amount) })) }
  return isExpenseClearanceLinkEdit(value) ? value : null
}
