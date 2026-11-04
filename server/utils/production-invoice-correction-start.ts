import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralInvoiceRecord } from '../../app/lib/invoice/central-contract'
import type { InvoiceCorrectionBuyer, InvoiceCorrectionContent } from '../../app/lib/invoice/correction-contract'
import type { BusinessSession } from './business-session'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { requireInvoiceCorrectionEligibility } from './production-invoice-correction-eligibility'

type Row = Record<string, unknown>
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
function sameContract(value: unknown, contract: CentralInvoiceRecord['contract']) {
  return contract === null
    ? value === null
    : object(value) && value.domain === contract.domain && value.id === contract.id && value.version === contract.version
}

/** 仅采用与当前票面完全一致的归档主体证明；无证据不按名称猜身份。 */
export function correctionBaselineIdentity(invoice: CentralInvoiceRecord, rows: Array<{ after_json: string, evidence_json: string }>, legacyRows: Array<{ after_json: string, evidence_json: string }> = []): { buyer: InvoiceCorrectionBuyer | null, supplierVersion: string | null } {
  for (const row of rows) {
    let after: unknown
    let evidence: unknown
    try {
      after = JSON.parse(row.after_json)
      evidence = JSON.parse(row.evidence_json)
    }
    catch { throw new CentralInvoiceProblem('unavailable', '归档主体原证据损坏，不能建立更正基准。') }
    if (!object(after) || !object(after.fields) || !object(evidence) || !object(evidence.taxVerification))
      continue
    const fields = after.fields
    if (after.id !== invoice.id || after.supplierId !== invoice.supplierId || ['buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo'].some(key => fields[key] !== invoice.fields[key as keyof CentralInvoiceRecord['fields']]))
      continue
    const buyer = evidence.taxVerification.buyer
    const supplier = evidence.taxVerification.supplier
    if (!object(buyer) || typeof buyer.id !== 'string' || !version(buyer.version) || typeof buyer.taxNo !== 'string'
      || !object(supplier) || supplier.id !== invoice.supplierId || !version(supplier.version) || typeof supplier.taxNo !== 'string'
      || buyer.taxNo.trim().toUpperCase() !== invoice.fields.buyerTaxNo.trim().toUpperCase()
      || supplier.taxNo.trim().toUpperCase() !== invoice.fields.sellerTaxNo.trim().toUpperCase()) {
      continue
    }
    return { buyer: { id: buyer.id, version: buyer.version }, supplierVersion: supplier.version }
  }
  for (const row of legacyRows) {
    let after: unknown
    let evidence: unknown
    try {
      after = JSON.parse(row.after_json)
      evidence = JSON.parse(row.evidence_json)
    }
    catch { throw new CentralInvoiceProblem('unavailable', '旧发票主体映射原证据损坏。') }
    if (!object(after) || !object(after.fields) || !object(evidence) || !object(evidence.entry) || !object(evidence.entry.companyAdoption))
      continue
    const fields = after.fields
    const adoption = evidence.entry.companyAdoption
    if (after.id !== invoice.id || invoice.ownerKind !== 'company' || after.ownerKind !== 'company' || after.supplierId !== invoice.supplierId || adoption.supplierId !== invoice.supplierId
      || !sameContract(after.contract, invoice.contract) || !sameContract(adoption.target, invoice.contract)
      || ['buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo'].some(key => fields[key] !== invoice.fields[key as keyof CentralInvoiceRecord['fields']])
      || typeof adoption.buyerId !== 'string' || !version(adoption.buyerVersion) || !version(adoption.supplierVersion)) {
      continue
    }
    return { buyer: { id: adoption.buyerId, version: adoption.buyerVersion }, supplierVersion: adoption.supplierVersion }
  }
  return { buyer: null, supplierVersion: null }
}

/** Caller first validates the immutable invoice journal and legacy source evidence. */
export async function readCorrectionBaselineIdentity(tx: TransactionDb, invoice: CentralInvoiceRecord) {
  const rows = await tx.select<{ after_json: string, evidence_json: string }>(`SELECT a.after_json,e.evidence_json FROM invoice_archive_evidence e
    JOIN invoice_audits a ON a.command_id=e.command_id AND a.invoice_id=e.invoice_id
    WHERE e.invoice_id=? AND CAST(json_extract(a.after_json,'$.version') AS INTEGER)<=?
    ORDER BY CAST(json_extract(a.after_json,'$.version') AS INTEGER) DESC`, [invoice.id, Number(invoice.version)])
  const legacyRows = invoice.sourceKind === 'legacy'
    ? await tx.select<{ after_json: string, evidence_json: string }>(`SELECT a.after_json,m.evidence_json FROM invoice_legacy_members m
    JOIN invoice_audits a ON a.command_id=m.genesis_command_id AND a.invoice_id=m.invoice_id
    WHERE m.invoice_id=? AND CAST(json_extract(a.after_json,'$.version') AS INTEGER)<=?`, [invoice.id, Number(invoice.version)])
    : []
  return correctionBaselineIdentity(invoice, rows, legacyRows)
}

/** 只读建立原票与更正对照，提交时仍必须再次检查资格和所有来源。 */
export async function readInvoiceCorrectionStart(tx: TransactionDb, actor: BusinessSession, invoiceId: string, baseVersion: string): Promise<{ invoice: CentralInvoiceRecord, baseline: InvoiceCorrectionContent }> {
  const invoice = await requireInvoiceCorrectionEligibility(tx, actor, invoiceId, baseVersion)
  if (!invoice.ownerKind)
    throw new CentralInvoiceProblem('unavailable', '原发票归属缺失，不能建立更正基准。')
  const identities = await readCorrectionBaselineIdentity(tx, invoice)
  return { invoice, baseline: { fields: structuredClone(invoice.fields), items: structuredClone(invoice.items), ownerKind: invoice.ownerKind, projectId: invoice.projectId, supplierId: invoice.supplierId, supplierVersion: identities.supplierVersion, buyer: identities.buyer, contract: invoice.contract ? { ...invoice.contract } : null } }
}
