import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralInvoiceRecord } from '../../app/lib/invoice/central-contract'
import type { BusinessSession } from './business-session'
import { financeFailure, FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { parsePaymentContractReference } from '../../app/lib/finance/payment-contract'
import { verifiedFinanceSum } from '../../app/lib/finance/persistent-rows'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { verifyPaymentContract } from './production-finance-contract'
import { financeCanonical } from './production-finance-request'
import { captureProductionInvoiceAdoption } from './production-invoice-service'

type Row = Record<string, unknown>
export interface FinanceInvoiceAdoption { allocationId: string, invoice: CentralInvoiceRecord }
export interface PaymentInvoiceEvidence { applicationId: string, applicationVersion: string, contract: { domain: string, id: string, version: string }, invoiceAdoptions: FinanceInvoiceAdoption[] }
export interface PaymentInvoiceCoverage { allocationId: string, applicationId: string, applicationVersion: string }
const object = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const invalid = () => financeFailure('unavailable', '付款采用的发票冻结证据不完整，请核对备份。')

/** 未注册的发票来源不能产生采用证据；旧财务数据继续保留原状。 */
export async function captureFinanceInvoiceAdoptions(tx: TransactionDb, actor: BusinessSession, applicationId: string): Promise<FinanceInvoiceAdoption[] | undefined> {
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=?', ['invoices'])
  if (!participant)
    return undefined
  if (![1, 2, 3, 4].includes(participant.schema_version))
    return invalid()
  const allocations = await tx.select<{ id: string, invoice_id: string }>('SELECT id,invoice_id FROM payment_application_invoice_allocations WHERE payment_application_id=? AND deleted_at IS NULL ORDER BY id', [applicationId])
  const adoptions: FinanceInvoiceAdoption[] = []
  for (const allocation of allocations) {
    try {
      adoptions.push({ allocationId: allocation.id, invoice: await captureProductionInvoiceAdoption(tx, actor, allocation.invoice_id) })
    }
    catch (cause) {
      if (cause instanceof CentralInvoiceProblem)
        throw new FinanceRepositoryProblem(cause.problem)
      throw cause
    }
  }
  return adoptions
}

/** New confirmations must not adopt project and company invoices across ownership scopes. */
export async function verifyPaymentInvoiceScope(tx: TransactionDb, actor: BusinessSession, applicationId: string) {
  const [application] = await tx.select<{ project_id: string | null, biz_type: string }>('SELECT project_id,biz_type FROM payment_applications WHERE id=? AND deleted_at IS NULL', [applicationId])
  if (!application)
    return financeFailure('unavailable', '付款申请来源不可用，请重新读取。')
  const lines = await tx.select<{ id: string }>('SELECT id FROM payment_application_invoice_allocations WHERE payment_application_id=? AND deleted_at IS NULL', [applicationId])
  if (!lines.length)
    return
  const adoptions = await captureFinanceInvoiceAdoptions(tx, actor, applicationId)
  if (!adoptions || adoptions.length !== lines.length)
    return financeFailure('unavailable', '付款发票来源无法核实。')
  if (adoptions.some(({ invoice }) => application.biz_type === '公司付款'
    ? invoice.ownerKind !== 'company' || invoice.projectId !== null
    : invoice.ownerKind !== 'project' || !application.project_id || invoice.projectId !== application.project_id)) {
    return financeFailure('validation-failed', '关联发票与付款申请的项目或公司归属不一致。')
  }
}

/** 确认支付前在同一事务核对当前票、申请和合同；不可按同名或跨领域同 ID 猜测。 */
export async function capturePaymentInvoiceEvidence(tx: TransactionDb, actor: BusinessSession, applicationId: string): Promise<PaymentInvoiceEvidence> {
  const [application] = await tx.select<{ contract_id: string | null, company_expense_contract_id: string | null, contract_domain: string | null, contract_version: string | null, project_id: string | null, supplier_id: string | null, biz_type: string, invoice_state: string, apply_amount: unknown }>('SELECT contract_id,company_expense_contract_id,contract_domain,contract_version,project_id,supplier_id,biz_type,invoice_state,apply_amount FROM payment_applications WHERE id=? AND deleted_at IS NULL', [applicationId])
  if (!application)
    return financeFailure('unavailable', '付款申请来源不可用，请重新读取。')
  const reference = parsePaymentContractReference({ domain: application.contract_domain, id: application.contract_domain === 'company' ? application.company_expense_contract_id : application.contract_id, version: application.contract_version })
  if (!reference)
    return financeFailure('unavailable', '付款合同领域或版本缺失，请重新选择并核对合同。')
  await verifyPaymentContract(tx, actor, reference, application.project_id, application.supplier_id, application.biz_type)
  const [version] = await tx.select<{ version: number }>('SELECT version FROM finance_versions WHERE kind=\'payment_application\' AND id=?', [applicationId])
  if (!version || !Number.isSafeInteger(version.version) || version.version < 1)
    return financeFailure('unavailable', '付款申请版本无法核实。')
  const adoptions = await captureFinanceInvoiceAdoptions(tx, actor, applicationId)
  if (!adoptions)
    return financeFailure('unavailable', '发票来源尚未接通，不能确认支付。')
  if (!adoptions.length)
    return financeFailure('validation-failed', '该付款有合同且需要发票，请先在付款申请中指定发票。')
  if (application.invoice_state === '先票后款') {
    const lines = await tx.select<{ allocated_amount: unknown }>('SELECT allocated_amount FROM payment_application_invoice_allocations WHERE payment_application_id=? AND deleted_at IS NULL', [applicationId])
    if (Math.abs(verifiedFinanceSum(lines.map(line => line.allocated_amount)) - verifiedFinanceSum([application.apply_amount])) > 0.0001)
      return financeFailure('validation-failed', '先票后款在确认支付前，关联发票金额必须等于申请金额。')
  }
  if (adoptions.some(item => !item.invoice.contract || item.invoice.contract.id !== reference.id || item.invoice.contract.domain !== reference.domain))
    return financeFailure('validation-failed', '关联发票与付款申请的合同不一致，请核对合同后再确认支付。')
  return { applicationId, applicationVersion: String(version.version), contract: reference, invoiceAdoptions: adoptions }
}

/** 同事务冻结每条有效分摊对应的申请版本，不能用后续申请状态倒推。 */
export async function capturePaymentInvoiceCoverage(tx: Pick<TransactionDb, 'select'>, recordId: string): Promise<PaymentInvoiceCoverage[]> {
  const allocations = await tx.select<{ id: string, payment_application_id: string }>('SELECT id,payment_application_id FROM payment_record_application_allocations WHERE payment_record_id=? AND deleted_at IS NULL ORDER BY id', [recordId])
  const coverage: PaymentInvoiceCoverage[] = []
  for (const allocation of allocations) {
    const [version] = await tx.select<{ version: number }>('SELECT version FROM finance_versions WHERE kind=\'payment_application\' AND id=?', [allocation.payment_application_id])
    if (!version || !Number.isSafeInteger(version.version) || version.version < 1)
      return invalid()
    coverage.push({ allocationId: allocation.id, applicationId: allocation.payment_application_id, applicationVersion: String(version.version) })
  }
  return coverage
}

/** 已确认支付以当时的申请版本和发票审计证明为准，不追溯更改历史。 */
export async function validatePaymentInvoiceEvidence(tx: Pick<TransactionDb, 'select'>, snapshot: Row, coverage?: unknown) {
  if (!Object.hasOwn(snapshot, 'paymentInvoiceEvidence'))
    return
  if (!Array.isArray(snapshot.paymentInvoiceEvidence) || !object(snapshot.relations) || !Array.isArray(snapshot.relations.payment_record_application_allocations))
    return invalid()
  if (coverage !== undefined) {
    if (!Array.isArray(coverage))
      return invalid()
    const allocations = snapshot.relations.payment_record_application_allocations.filter(row => object(row) && row.deleted_at === null)
    if (coverage.length !== allocations.length)
      return invalid()
    const allocationIds = new Set<string>()
    const required = new Map<string, string>()
    for (const entry of coverage) {
      if (!object(entry) || Object.keys(entry).sort().join(',') !== 'allocationId,applicationId,applicationVersion' || typeof entry.allocationId !== 'string' || allocationIds.has(entry.allocationId)
        || typeof entry.applicationId !== 'string' || typeof entry.applicationVersion !== 'string' || !/^[1-9]\d*$/.test(entry.applicationVersion)
        || !allocations.some(row => object(row) && row.id === entry.allocationId && row.payment_application_id === entry.applicationId)) {
        return invalid()
      }
      allocationIds.add(entry.allocationId)
      const [history] = await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'payment_application\' AND id=? AND version=?', [entry.applicationId, Number(entry.applicationVersion)])
      let application: unknown
      try {
        application = JSON.parse(history?.snapshot_json ?? '')
      }
      catch { return invalid() }
      if (!object(application) || !object(application.head) || application.head.id !== entry.applicationId)
        return invalid()
      const hasContract = Boolean(application.head.contract_id || application.head.company_expense_contract_id)
      if (hasContract && !['先票后款', '先款后票', '无需发票'].includes(String(application.head.invoice_state)))
        return invalid()
      if (hasContract && application.head.invoice_state !== '无需发票') {
        if (required.has(entry.applicationId))
          return invalid()
        required.set(entry.applicationId, entry.applicationVersion)
      }
    }
    if (snapshot.paymentInvoiceEvidence.length !== required.size || snapshot.paymentInvoiceEvidence.some(proof => !object(proof) || required.get(String(proof.applicationId)) !== proof.applicationVersion))
      return invalid()
  }
  const seen = new Set<string>()
  for (const proof of snapshot.paymentInvoiceEvidence) {
    if (!object(proof) || typeof proof.applicationId !== 'string' || seen.has(proof.applicationId) || typeof proof.applicationVersion !== 'string' || !/^[1-9]\d*$/.test(proof.applicationVersion)
      || !object(proof.contract) || !['construction', 'subcontract', 'material', 'auxiliary', 'company'].includes(String(proof.contract.domain)) || typeof proof.contract.id !== 'string'
      || !Array.isArray(proof.invoiceAdoptions) || !proof.invoiceAdoptions.length
      || !snapshot.relations.payment_record_application_allocations.some(row => object(row) && row.payment_application_id === proof.applicationId && row.deleted_at === null)) {
      return invalid()
    }
    const contract = proof.contract
    seen.add(proof.applicationId)
    const [history] = await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'payment_application\' AND id=? AND version=?', [proof.applicationId, Number(proof.applicationVersion)])
    let application: Row
    try {
      application = JSON.parse(history?.snapshot_json ?? '')
    }
    catch { return invalid() }
    if (!object(application.head) || application.head.id !== proof.applicationId || (contract.domain === 'company' ? application.head.company_expense_contract_id !== contract.id : application.head.contract_id !== contract.id)
      || !['先票后款', '先款后票'].includes(String(application.head.invoice_state))) {
      return invalid()
    }
    // New proofs bind the selected domain and version to the application snapshot.
    // Historical proofs without a version retain their original validation path.
    if (Object.hasOwn(contract, 'version') && (!parsePaymentContractReference(contract)
      || application.head.contract_domain !== contract.domain || application.head.contract_version !== contract.version)) {
      return invalid()
    }
    const adopted = { relations: application.relations, invoiceAdoptions: proof.invoiceAdoptions }
    await validateFinanceInvoiceAdoptions(tx, adopted)
    if (proof.invoiceAdoptions.some(item => !object(item) || !object(item.invoice) || !object(item.invoice.contract)
      || item.invoice.contract.id !== contract.id || item.invoice.contract.domain !== contract.domain)) {
      return invalid()
    }
  }
}

/** 采用证据必须对应当时的分摊行及发票不可变审计或打印版本。 */
export async function validateFinanceInvoiceAdoptions(tx: Pick<TransactionDb, 'select'>, snapshot: Row) {
  if (!Object.hasOwn(snapshot, 'invoiceAdoptions'))
    return
  if (!Array.isArray(snapshot.invoiceAdoptions) || !object(snapshot.relations) || !Array.isArray(snapshot.relations.payment_application_invoice_allocations))
    return invalid()
  const active = snapshot.relations.payment_application_invoice_allocations.filter(row => object(row) && row.deleted_at === null)
  if (active.length !== snapshot.invoiceAdoptions.length)
    return invalid()
  const seen = new Set<string>()
  for (const adoption of snapshot.invoiceAdoptions) {
    if (!object(adoption) || Object.keys(adoption).sort().join(',') !== 'allocationId,invoice' || typeof adoption.allocationId !== 'string' || seen.has(adoption.allocationId)
      || !object(adoption.invoice) || typeof adoption.invoice.id !== 'string' || typeof adoption.invoice.version !== 'string' || !/^[1-9]\d*$/.test(adoption.invoice.version)) {
      return invalid()
    }
    const invoice = adoption.invoice
    if (!active.some(row => object(row) && row.id === adoption.allocationId && row.invoice_id === invoice.id))
      return invalid()
    seen.add(adoption.allocationId)
    const audits = await tx.select<{ after_json: string }>('SELECT after_json FROM invoice_audits WHERE invoice_id=? UNION ALL SELECT after_json FROM invoice_print_lines WHERE invoice_id=?', [invoice.id, invoice.id])
    if (!audits.some((row) => {
      try {
        return financeCanonical(JSON.parse(row.after_json)) === financeCanonical(invoice)
      }
      catch { return false }
    })) {
      return invalid()
    }
  }
}
