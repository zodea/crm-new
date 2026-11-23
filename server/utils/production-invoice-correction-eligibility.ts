import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralInvoiceRecord } from '../../app/lib/invoice/central-contract'
import type { BusinessSession } from './business-session'
import { CentralInvoiceProblem, INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY } from '../../app/lib/invoice/central-contract'
import { validateFinanceJournal } from './production-finance-journal'
import { invoiceContractCapability } from './production-invoice-contracts'
import { readProductionInvoiceFact, validateProductionInvoiceJournal } from './production-invoice-service'

/** Call within the eventual correction transaction, never as a substitute for its final recheck. */
export async function requireInvoiceCorrectionEligibility(tx: TransactionDb, actor: BusinessSession, invoiceId: string, baseVersion: string): Promise<CentralInvoiceRecord> {
  function fail(code: ConstructorParameters<typeof CentralInvoiceProblem>[0], message: string): never {
    throw new CentralInvoiceProblem(code, message)
  }
  const metadata = (await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1'))[0]
  if (!metadata || metadata.workspace_id !== actor.workspaceId || metadata.owner_id !== actor.actorId
    || ![INVOICE_READ_CAPABILITY, INVOICE_WRITE_CAPABILITY, 'finance-payment-application:read', 'finance-payment-record:read'].every(capability => actor.capabilities.includes(capability))) {
    return fail('forbidden', '没有发票或付款来源读取权限，不能核对更正资格。')
  }
  const participants = await tx.select<{ domain: string, schema_version: number }>('SELECT domain,schema_version FROM production_participants WHERE domain IN (\'invoices\',\'finance\')')
  if (!participants.some(row => row.domain === 'invoices' && [1, 2, 3, 4, 5].includes(row.schema_version)) || !participants.some(row => row.domain === 'finance' && [1, 2].includes(row.schema_version)))
    return fail('unavailable', '发票或付款正式来源不可核实，不能更正。')
  await validateProductionInvoiceJournal(tx, actor)
  await validateFinanceJournal(tx, actor)
  const invoice = await readProductionInvoiceFact(tx, invoiceId)
  if (!actor.capabilities.includes('our-signatory:read')
    || (invoice.projectId && !actor.capabilities.includes('project:list:read'))
    || (invoice.supplierId && !actor.capabilities.includes('supplier:list:read'))
    || (invoice.contract && !actor.capabilities.includes(invoiceContractCapability(invoice.contract.domain)))) {
    return fail('forbidden', '没有原发票主体、项目、分供方或合同来源读取权限。')
  }
  if (invoice.deletedAt || invoice.accountStatus !== 'archived')
    return fail('conflict', '仅可更正未删除且已归档的发票。')
  if (invoice.version !== baseVersion)
    return fail('conflict', '发票基准版本已变化，请重新核对。')
  if (invoice.printCount > 0 || (await tx.select('SELECT invoice_id FROM invoice_print_lines WHERE invoice_id=? LIMIT 1', [invoiceId])).length)
    return fail('conflict', '发票已有打印历史，请先人工核对。')
  if ((await tx.select('SELECT id FROM payment_application_invoice_allocations WHERE invoice_id=? LIMIT 1', [invoiceId])).length)
    return fail('conflict', '发票已有付款关联或历史，请先人工核对。')
  return invoice
}
