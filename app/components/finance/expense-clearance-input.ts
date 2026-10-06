import type { ExpenseClearanceVerificationEdit } from '~/lib/finance/clearance-verification'
import { isExpenseClearanceVerificationEdit } from '~/lib/finance/clearance-verification'

export interface ExpenseClearanceInput {
  originalExpenseLineId: string
  sourceVersion: string
  sourceHash: string
  basis: string
  fileIds: string[]
  items: Array<{ id?: string, sourceClearanceLineId: string | null, amount: string, matchBasis: string }>
}
export const emptyExpenseClearanceInput = (): ExpenseClearanceInput => ({ originalExpenseLineId: '', sourceVersion: '', sourceHash: '', basis: '', fileIds: [], items: [] })
export function expenseClearanceEdit(input: ExpenseClearanceInput): ExpenseClearanceVerificationEdit | null {
  if (input.items.some(item => !/^\d+(?:\.\d+)?$/.test(item.amount)))
    return null
  const value = { ...input, items: input.items.map(item => ({ ...item, amount: Number(item.amount) })), existingBindings: [] }
  return isExpenseClearanceVerificationEdit(value) ? value : null
}
