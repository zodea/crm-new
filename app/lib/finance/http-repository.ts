import type { LookupOption } from '../kit/lookup'
import type { CentralFinanceKind, CentralFinanceListRow, FinanceCommand, FinanceCommandResult, FinanceContext, FinanceFormRead, FinanceReadEnvelope, FinanceReadScope, FinanceRepository } from './central-contract'
import { isISODateDTO, isISODateTimeDTO } from '../../types/read-model'
import { decodeConstructionMainSelection } from '../construction-scope/contract'
import { isDecimalString } from '../read-model/decimal'
import { hasConsistentReadMeta } from '../read-model/meta'
import { FINANCE_FAMILIES, FINANCE_READ_SCHEMA, financeFailure, financeProblemFromUnknown, normalizeFinanceLookup } from './central-contract'
import { isExpenseClearanceVerificationState } from './clearance-verification'
import { FINANCE_OWNER_TYPE, pendingInvoiceAmountForRead } from './domain'
import { decodePaymentApplicationDetail } from './payment-detail-repository'
import { isPaymentVerificationState } from './payment-verification'

export type FinanceFetcher = (url: string, options?: { method?: 'POST', body?: unknown, query?: Record<string, unknown>, responseType?: 'arrayBuffer' }) => Promise<unknown>
const path = (kind: CentralFinanceKind) => `/api/read/finance/${kind}`
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown): value is string => typeof value === 'string'
const id = (value: unknown): value is string => text(value) && /^[a-z0-9][\w-]{2,99}$/i.test(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const date = (value: unknown) => value === '' || isISODateDTO(value)
const nullableId = (value: unknown) => value === null || id(value)
const nullableText = (value: unknown) => value === null || text(value)
function broken(): never {
  return financeFailure('unavailable', '财务身份、金额、关系或来源证据尚未可靠读取，请保留原输入和编号。')
}
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (object(value))
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export function decodeFinanceContext(value: unknown, scope: FinanceReadScope): FinanceContext {
  if (!object(value) || !hasConsistentReadMeta(value, FINANCE_READ_SCHEMA, 'real') || !object(value.meta)
    || value.workspaceId !== value.meta.workspaceId || value.actorId !== value.meta.actorId || value.dataOrigin !== 'real'
    || canonical(value.scope) !== canonical(scope) || !Array.isArray(value.capabilities)
    || !value.capabilities.includes(`${FINANCE_FAMILIES[scope.kind]}:read`)
    || !Array.isArray(value.meta.sources) || !value.meta.sources.some(source => object(source) && source.key === 'finance' && source.state === 'readable' && source.sourceVersion !== null && source.asOf === value.asOf)
    || !object(value.meta.authorizedScope) || value.meta.authorizedScope.coverage !== 'complete') {
    broken()
  }
  return value as unknown as FinanceContext
}
const context = decodeFinanceContext
function uniqueRows(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every(row => object(row) && id(row.id)) && new Set(value.map(row => row.id)).size === value.length
}
const draftFields: Record<CentralFinanceKind, readonly string[]> = {
  current: ['no', 'note', 'status', 'direction', 'counterparty', 'purpose', 'paymentMethod', 'transactionDate', 'bankSerialNo', 'handler'],
  reimbursement: ['no', 'note', 'status', 'applicant', 'category', 'reimbursementDate', 'reason', 'externalRef'],
  payment_application: ['no', 'note', 'status', 'name', 'bizType', 'costName', 'applyDate', 'applicant', 'invoiceState', 'payContent', 'prepayNote', 'approvalNote', 'externalRef'],
  payment_record: ['no', 'note', 'payeeName', 'purpose', 'paymentDate', 'paymentMethod', 'voucherNo', 'bankSerialNo', 'payeeAccount', 'payeeBank', 'payeeBankAccount', 'handler', 'source', 'recognitionStatus', 'ocrPayload', 'fieldConfidence', 'confirmationStatus', 'confirmedBy', 'externalRef'],
  invoice_application: ['no', 'note', 'status', 'name', 'buyerNameSnapshot', 'buyerTaxNoSnapshot', 'invoiceType', 'invoiceContent', 'invoiceRemark', 'applicant', 'applicationDate'],
}
function relationRows(value: unknown, target: string) {
  return uniqueRows(value) && value.every(row => id(row[target]) && finite(row.allocatedAmount) && row.allocatedAmount > 0 && text(row.note)) && new Set(value.map(row => row[target])).size === value.length
}
function validDraft(kind: CentralFinanceKind, value: unknown, target: string): boolean {
  if (!object(value) || value.id !== target || !id(value.id) || !draftFields[kind].every(field => text(value[field])) || !nullableId(value.projectId))
    return false
  for (const field of ['supplierId', 'workerId', 'contractId', 'customerId', 'applicantWorkerId', 'applicantSupplierId']) {
    if (Object.hasOwn(value, field) && !nullableId(value[field]))
      return false
  }
  for (const field of ['counterpartyNameSnapshot', 'applicantNameSnapshot', 'payeeNameSnapshot']) {
    if (Object.hasOwn(value, field) && !nullableText(value[field]))
      return false
  }
  if (value.workerId && value.supplierId)
    return false
  if (kind === 'current')
    return ['receipt', 'payment'].includes(String(value.direction)) && finite(value.amount) && value.amount >= 0 && date(value.transactionDate)
  if (kind === 'reimbursement') {
    return !(value.applicantWorkerId && value.applicantSupplierId) && Number.isSafeInteger(value.invoiceCount) && Number(value.invoiceCount) >= 0 && finite(value.totalAmount) && value.totalAmount >= 0 && date(value.reimbursementDate)
      && uniqueRows(value.lines) && value.lines.every(line => finite(line.amount) && line.amount > 0 && text(line.expenseItem) && date(line.expenseDate) && text(line.note) && nullableId(line.originalExpenseLineId) && line.originalExpenseLineId !== line.id && nullableId(line.counterpartySupplierId) && nullableText(line.counterpartyNameSnapshot))
      && Math.abs(value.totalAmount - value.lines.reduce((total, line) => total + Number(line.amount), 0)) < 0.0001
      && (value.clearanceVerification === undefined || (isExpenseClearanceVerificationState(value.clearanceVerification)
        && value.clearanceVerification.sources.every(source => source.headerId === value.id)
        && value.clearanceVerification.proofs.every(proof => proof.headerId === value.id)))
  }
  if (kind === 'invoice_application')
    return ['amount', 'taxRate', 'taxAmount', 'totalAmount'].every(field => finite(value[field]) && Number(value[field]) >= 0) && Math.abs(Number(value.totalAmount) - Number(value.amount) - Number(value.taxAmount)) < 0.0001 && date(value.applicationDate)
  if (kind === 'payment_record')
    return finite(value.amount) && value.amount >= 0 && date(value.paymentDate) && (value.confirmedAt === null || isISODateTimeDTO(value.confirmedAt)) && ['manual', 'image_ocr', 'excel_import'].includes(String(value.source)) && ['draft', 'needs_review', 'confirmed'].includes(String(value.confirmationStatus)) && relationRows(value.applicationAllocations, 'paymentApplicationId')
  return ['applyAmount', 'prepayDeduct', 'settlementAllocated', 'invoiceAllocated', 'pendingInvoiceAmount', 'paidAmount'].every(field => finite(value[field]) && Number(value[field]) >= 0)
    && ['settlementDifference', 'invoiceDifference'].every(field => finite(value[field])) && (value.approvedAmount === null || (finite(value.approvedAmount) && value.approvedAmount >= 0))
    && ['legacy', 'user-entry'].includes(String(value.approvedAmountOrigin)) && ['先票后款', '先款后票', '无需发票'].includes(String(value.invoiceState)) && date(value.applyDate)
    && value.pendingInvoiceAmount === pendingInvoiceAmountForRead(value.invoiceState, value.applyAmount, value.invoiceAllocated)
    && relationRows(value.settlementAllocations, 'settlementId') && relationRows(value.invoiceAllocations, 'invoiceId')
}
function form<K extends CentralFinanceKind>(value: unknown, kind: K, target: string): FinanceFormRead<K> {
  context(value, { kind, operation: 'form', id: target })
  if (object(value) && object(value.draft) && Object.hasOwn(value.draft, 'paymentVerification') && (kind !== 'payment_application' || !isPaymentVerificationState(value.draft.paymentVerification, target)))
    broken()
  if (object(value) && object(value.draft) && isPaymentVerificationState(value.draft.paymentVerification, target)) {
    const proof = value.draft.paymentVerification.proof
    if (proof && (proof.actorId !== value.actorId || proof.workspaceId !== value.workspaceId || proof.applicationVersion !== value.version))
      broken()
    if (value.draft.approvedAmount === 0 && value.draft.approvedAmountOrigin === 'legacy' && !value.draft.paymentVerification.required)
      broken()
  }
  if (!object(value) || !validDraft(kind, value.draft, target) || !text(value.version) || !/^[1-9]\d*$/.test(value.version) || !isISODateTimeDTO(value.updatedAt) || !uniqueRows(value.attachments)
    || value.attachments.some(file => file.ownerType !== FINANCE_OWNER_TYPE[kind] || file.ownerId !== target || !text(file.fileName) || !file.fileName.trim() || !text(file.filePath) || !Number.isSafeInteger(file.fileSize) || Number(file.fileSize) < 0 || !text(file.mimeType) || !text(file.category) || !text(file.uploader) || !isISODateTimeDTO(file.uploadedAt) || !(file.deletedAt === null || isISODateTimeDTO(file.deletedAt)) || !(file.sha256 === null || (text(file.sha256) && /^[a-f0-9]{64}$/.test(file.sha256))))) {
    broken()
  }
  return value as unknown as FinanceFormRead<K>
}
function list(value: unknown, kind: CentralFinanceKind): FinanceReadEnvelope<CentralFinanceListRow> {
  context(value, { kind, operation: 'list' })
  if (!object(value) || !uniqueRows(value.items) || value.items.some(row => !['no', 'name', 'projectName', 'partyName', 'status'].every(field => text(row[field])) || !isDecimalString(row.amount) || Number(row.amount) < 0 || !date(row.date) || !nullableId(row.customerId) || row.dataOrigin !== 'real'))
    broken()
  return value as unknown as FinanceReadEnvelope<CentralFinanceListRow>
}
function requireReadSource(value: FinanceContext, source: string, capability: string) {
  if (!value.capabilities.includes(capability) || !value.meta.sources.some(row => row.key === source && row.state === 'readable' && row.sourceVersion !== null && row.asOf === value.asOf))
    broken()
}
function verifyLookupSources(value: FinanceContext, query: ReturnType<typeof normalizeFinanceLookup>) {
  if (query.kind === 'construction-mains') {
    requireReadSource(value, 'construction-contracts', 'construction-contract:read')
    requireReadSource(value, 'projects', 'project:list:read')
    return
  }
  const source = query.kind === 'original-expenses' || query.kind === 'payment-applications' ? 'finance' : query.kind === 'settlements' ? 'expenditure-settlements' : query.kind
  const cap = query.kind === 'original-expenses' ? 'finance-reimbursement:read' : query.kind === 'payment-applications' ? 'finance-payment-application:read' : query.kind === 'settlements' ? 'other-settlement:read' : query.kind === 'invoices' ? 'finance-invoice:read' : `${query.kind.slice(0, -1)}:list:read`
  if (query.kind !== 'contracts') {
    requireReadSource(value, source, cap)
    return
  }
  const kinds = query.contractKinds?.length ? query.contractKinds : ['施工', '分包', '材采', '其他支出']
  const sources: Record<string, [string, string]> = { 施工: ['construction-contracts', 'construction-contract:read'], 分包: ['subcontract-contracts', 'subcontract-contract:read'], 材采: ['material-contracts', 'material-contract:read'], 其他支出: ['auxiliary-contracts', 'auxiliary-contract:read'] }
  kinds.forEach(kind => requireReadSource(value, ...sources[kind]!))
}
function result(value: unknown, commandId: string, target?: string): FinanceCommandResult {
  if (object(value) && value.expenseLineIdentities !== undefined && (!Array.isArray(value.expenseLineIdentities) || value.expenseLineIdentities.some(row => !object(row) || Object.keys(row).sort().join(',') !== 'id,inputIndex' || !id(row.id) || !Number.isSafeInteger(row.inputIndex) || Number(row.inputIndex) < 0)
    || new Set(value.expenseLineIdentities.map(row => row.id)).size !== value.expenseLineIdentities.length || new Set(value.expenseLineIdentities.map(row => row.inputIndex)).size !== value.expenseLineIdentities.length)) {
    broken()
  }
  if (object(value) && value.constructionScopeLinks !== undefined && (!Array.isArray(value.constructionScopeLinks) || value.constructionScopeLinks.some(row => !object(row) || !id(row.commandId) || !object(row.relation) || row.relation.domain !== 'original-expense' || !id(row.relation.sourceId) || !id(row.relation.id) || !id(row.relation.mainId) || typeof row.relation.version !== 'string' || !/^[1-9]\d*$/.test(row.relation.version))))
    broken()
  if (object(value) && Object.hasOwn(value, 'paymentVerificationSha256') && (typeof value.paymentVerificationSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.paymentVerificationSha256)))
    broken()
  if (object(value) && (Object.hasOwn(value, 'clearanceVerificationSha256') || Object.hasOwn(value, 'clearanceVerificationId'))
    && (!id(value.clearanceVerificationId) || typeof value.clearanceVerificationSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.clearanceVerificationSha256))) {
    broken()
  }
  if (!object(value) || !id(value.id) || value.commandId !== commandId || (target && value.id !== target) || !text(value.version) || !/^[1-9]\d*$/.test(value.version) || !isISODateTimeDTO(value.updatedAt) || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(id) || new Set(value.attachmentIds).size !== value.attachmentIds.length || !(value.logId === null || id(value.logId)))
    broken()
  return value as unknown as FinanceCommandResult
}
export function createFinanceRepository(fetcher: FinanceFetcher): FinanceRepository {
  async function read(url: string, options?: Parameters<FinanceFetcher>[1]): Promise<unknown> {
    try {
      return await fetcher(url, options)
    }
    catch (cause) { throw financeProblemFromUnknown(cause) }
  }
  return {
    paymentDetail: async (target) => {
      const value = await read(`${path('payment_application')}/detail/${encodeURIComponent(target)}`)
      context(value, { kind: 'payment_application', operation: 'detail', id: target })
      return decodePaymentApplicationDetail(value, target)
    },
    context: async kind => context(await read(`${path(kind)}/context`), { kind, operation: 'context' }),
    form: async (kind, target) => form(await read(`${path(kind)}/form/${encodeURIComponent(target)}`), kind, target),
    list: async kind => list(await read(`${path(kind)}/list`), kind),
    lookup: async (kind, input) => {
      const query = normalizeFinanceLookup(input)
      const value = await read(`${path(kind)}/lookup`, { query: { ...query } })
      verifyLookupSources(context(value, { kind, operation: 'lookup', query }), query)
      if (!object(value) || !uniqueRows(value.items) || value.items.some(row => !text(row.label) || !row.label.trim() || (row.hint !== undefined && !text(row.hint))))
        broken()
      if (query.kind === 'construction-mains') {
        for (const row of value.items) {
          try {
            const selected = decodeConstructionMainSelection(row.constructionMain)
            if (selected.id !== row.id || (query.projectId && selected.projectId !== query.projectId))
              broken()
          }
          catch { broken() }
        }
      }
      return value as unknown as FinanceReadEnvelope<LookupOption>
    },
    customer: async (kind, target) => {
      const value = await read(`${path(kind)}/customer/${encodeURIComponent(target)}`)
      requireReadSource(context(value, { kind, operation: 'customer', id: target }), 'customers', 'customer:list:read')
      if (!object(value) || !Array.isArray(value.items) || value.items.length > 1 || value.items.some(row => !object(row) || !text(row.name) || !text(row.taxNo)))
        broken()
      return value as unknown as FinanceReadEnvelope<{ name: string, taxNo: string }>
    },
    execute: async (request: FinanceCommand) => result(await read('/api/commands/finance', { method: 'POST', body: request }), request.commandId, request.id),
    resolve: async (kind, commandId) => {
      const value = await read('/api/commands/finance/resolve', { method: 'POST', body: { kind, commandId } })
      if (!object(value))
        broken()
      if (value.outcome === 'applied')
        return { outcome: 'applied', result: result(value.result, commandId) }
      if (value.outcome !== 'not-applied' || value.commandId !== commandId)
        broken()
      return { outcome: 'not-applied', commandId }
    },
    original: async (kind, target, fileId) => {
      const bytes = await read(`${path(kind)}/files/${encodeURIComponent(target)}/${encodeURIComponent(fileId)}`, { responseType: 'arrayBuffer' })
      if (!(bytes instanceof ArrayBuffer))
        broken()
      return { bytes: new Uint8Array(bytes), mimeType: 'application/octet-stream' }
    },
  }
}
