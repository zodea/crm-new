import type { F3FormDraft, F3FormKind, F3SaveAction, F3SaveResult, FinanceFormRecordMap, PaymentApplicationSummary } from './domain'
import type { TransactionDb } from '~/lib/db/coordinator'
import type { FileRefChanges, FileRefRecord } from '~/lib/forms/file-refs'
import { select, withTransaction } from '~/lib/db/connection'
import { applyFileRefChanges, listFileRefs } from '~/lib/forms/file-refs'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { deleteFinanceFormInTransaction, loadFinanceForm as domainLoad, getPaymentApplicationSummary as domainSummary, FINANCE_OWNER_TYPE, saveFinanceFormInTransaction, unconfirmPaymentRecordInTransaction } from './domain'
import { verifiedFinanceSum } from './persistent-rows'

export * from './domain'

/** Native facade; the production owner imports the transaction-only domain. */
export async function saveFinanceForm(kind: F3FormKind, draft: F3FormDraft, action: F3SaveAction, attachments: FileRefChanges = {}): Promise<F3SaveResult> {
  if (kind === 'receipt' && 'window' in globalThis && !isDesktopRuntime())
    throw new Error('浏览器收款请通过中央收款表单保存')
  return withTransaction(async (tx) => {
    const saved = await saveFinanceFormInTransaction(kind, draft, action, tx)
    const { expenseLineIds: _expenseLineIds, ...result } = saved
    return { ...result, attachmentIds: await applyFileRefChanges(tx, FINANCE_OWNER_TYPE[kind], saved.id, attachments) }
  })
}
export async function loadFinanceForm<K extends F3FormKind>(kind: K, id: string, db: Pick<TransactionDb, 'select'> = { select }): Promise<FinanceFormRecordMap[K] | null> {
  return domainLoad(kind, id, db)
}
export function getPaymentApplicationSummary(id: string, db: Pick<TransactionDb, 'select'> = { select }): Promise<PaymentApplicationSummary> {
  return domainSummary(id, db)
}
export function listFinanceFormAttachments(kind: F3FormKind, id: string, includeDeleted = false): Promise<FileRefRecord[]> {
  return listFileRefs(FINANCE_OWNER_TYPE[kind], id, includeDeleted)
}
export async function unconfirmPaymentRecord(id: string): Promise<void> {
  await withTransaction(tx => unconfirmPaymentRecordInTransaction(id, tx))
}
export function deleteFinanceForm(kind: F3FormKind, id: string): Promise<string | null> {
  return withTransaction(tx => deleteFinanceFormInTransaction(kind, id, tx))
}
export async function getProjectConfirmedPaymentTotal(projectId: string): Promise<number> {
  const rows = await select<{ amount: unknown }>('SELECT amount FROM payment_records WHERE project_id=? AND confirmation_status=\'confirmed\' AND deleted_at IS NULL', [projectId])
  return verifiedFinanceSum(rows.map(row => row.amount))
}
