import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CentralInvoiceCommand, CentralInvoiceCommandResult, CentralInvoiceFields, CentralInvoiceItem, CentralInvoiceRecord, InvoiceOriginalVerificationRead } from '../../app/lib/invoice/central-contract'
import { CentralInvoiceProblem, CONFIRM_ORIGINAL_VERIFICATION, RECORD_ORIGINAL_VERIFICATION } from '../../app/lib/invoice/central-contract'
import { commandFingerprint } from './command-journal'

export type VerificationRequest = Extract<CentralInvoiceCommand, { action: typeof RECORD_ORIGINAL_VERIFICATION | typeof CONFIRM_ORIGINAL_VERIFICATION }>
type CandidateRequest = Extract<VerificationRequest, { action: typeof RECORD_ORIGINAL_VERIFICATION }>
type ConfirmRequest = Extract<VerificationRequest, { action: typeof CONFIRM_ORIGINAL_VERIFICATION }>
interface Candidate { request: CandidateRequest, fields: CentralInvoiceFields, items: CentralInvoiceItem[] }
interface Confirmation {
  request: ConfirmRequest
  candidateSha256: string
  checkedSha256: string
  printCount: number
  correction: { id: string, invoiceVersion: string } | null
}
export type VerificationEvidence = Candidate | Confirmation
interface Saved<T> { version: number, sha256: string, evidence: T }
export interface VerificationHistory {
  candidate?: Saved<Candidate>
  confirmation?: Saved<Confirmation>
}
type SelectDb = Pick<TransactionDb, 'select'>
interface Row {
  command_id: string
  invoice_id: string
  invoice_version: number
  original_id: string
  candidate_id: string | null
  evidence_json: string
  result_json: string
  fingerprint: string
  action: string
}

export const invoiceVerificationActions = [RECORD_ORIGINAL_VERIFICATION, CONFIRM_ORIGINAL_VERIFICATION] as const
export const isInvoiceVerificationAction = (value: unknown): boolean => typeof value === 'string' && (invoiceVerificationActions as readonly string[]).includes(value)

function corrupt(): never {
  throw new CentralInvoiceProblem('unavailable', '发票原件核验记录、原回执或审计证据不完整。')
}

export async function hasOriginalVerificationSchema(tx: SelectDb) {
  const [participant] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'invoices\'')
  return [4, 5].includes(participant?.schema_version ?? 0)
}

export function matchesVerificationOriginal(invoice: CentralInvoiceRecord, request: VerificationRequest): boolean {
  return invoice.sourceKind === 'excel' && invoice.accountStatus === 'archived' && invoice.deletedAt === null
    && invoice.original?.id === request.originalId && invoice.original.sha256 === request.originalSha256
    && invoice.id === request.invoiceId
}

function checkedDigest(invoice: CentralInvoiceRecord) {
  const { fields, items, ownerKind, projectId, supplierId, contract } = invoice
  return commandFingerprint({ fields, items, ownerKind, projectId, supplierId, contract })
}

const requiredFields = ['invoiceNumber', 'invoiceDate', 'buyer', 'buyerTaxNo', 'seller', 'sellerTaxNo', 'amount', 'taxAmount', 'totalAmount'] as const
const optionalFields = ['invoiceType', 'taxRate'] as const
const lineFields = ['name', 'spec', 'unit', 'quantity', 'unitPrice', 'amount', 'taxRate', 'taxAmount'] as const
type ComparisonRow = InvoiceOriginalVerificationRead['rows'][number]

function compareValue(path: string, archived: ComparisonRow['archived'], recognized: ComparisonRow['recognized'], required: boolean): ComparisonRow {
  const missing = (value: ComparisonRow['archived']) => value === null || (typeof value === 'string' && !value.trim())
  const normalized = (value: ComparisonRow['archived']) => typeof value === 'string' ? value.normalize('NFKC').trim() : value
  const result = missing(recognized) && (required || !missing(archived))
    ? 'missing'
    : normalized(archived) === normalized(recognized) ? 'match' : 'different'
  return { path, archived, recognized, result }
}

function compare(invoice: CentralInvoiceRecord, candidate: Candidate) {
  const rows = [
    ...requiredFields.map(field => compareValue(field, invoice.fields[field], candidate.fields[field], true)),
    ...optionalFields.map(field => compareValue(field, invoice.fields[field], candidate.fields[field], false)),
  ]
  if (invoice.items.length !== candidate.items.length)
    rows.push(compareValue('items', invoice.items.length, candidate.items.length, false))
  for (const [index, item] of candidate.items.entries()) {
    for (const field of lineFields)
      rows.push(compareValue(`items.${index}.${field}`, invoice.items[index]?.[field] ?? null, item[field], field === 'name'))
  }
  return rows
}

export function currentVerificationId(invoice: CentralInvoiceRecord, history: VerificationHistory): string | undefined {
  const proof = history.confirmation
  const request = proof?.evidence.request
  if (proof && request && history.candidate && history.candidate.evidence.request.commandId === request.candidateId
    && proof.evidence.candidateSha256 === history.candidate.sha256 && matchesVerificationOriginal(invoice, request)
    && Number(invoice.version) - proof.version === invoice.printCount - proof.evidence.printCount
    && Number(invoice.version) >= proof.version && checkedDigest(invoice) === proof.evidence.checkedSha256) {
    return request.commandId
  }
}

async function effectiveCorrection(tx: SelectDb, invoice: CentralInvoiceRecord, candidate: Saved<Candidate>) {
  if (Number(invoice.version) === candidate.version)
    return null
  const [correction] = await tx.select<{ id: string }>(
    'SELECT id FROM invoice_corrections WHERE invoice_id=? AND state=\'submitted\' AND result_invoice_version=? AND base_invoice_version>=?',
    [invoice.id, Number(invoice.version), candidate.version],
  )
  return correction ? { id: correction.id, invoiceVersion: invoice.version } : undefined
}

export async function describeVerification(tx: SelectDb, invoice: CentralInvoiceRecord, history: VerificationHistory): Promise<InvoiceOriginalVerificationRead | null> {
  const { candidate, confirmation } = history
  if (!candidate || !matchesVerificationOriginal(invoice, candidate.evidence.request))
    return null
  const rows = compare(invoice, candidate.evidence)
  const unrecognizedPageIndexes = candidate.evidence.request.unrecognizedPageIndexes
  let state: InvoiceOriginalVerificationRead['state']
  if (currentVerificationId(invoice, history))
    state = 'confirmed'
  else if (confirmation || await effectiveCorrection(tx, invoice, candidate) === undefined)
    state = 'stale'
  else if (rows.some(row => row.result === 'missing') || unrecognizedPageIndexes.length)
    state = 'incomplete'
  else
    state = rows.some(row => row.result === 'different') ? 'different' : 'ready'
  return { candidateId: candidate.evidence.request.commandId, source: candidate.evidence.request.source, unrecognizedPageIndexes, rows, state }
}

export async function confirmVerification(tx: SelectDb, invoice: CentralInvoiceRecord, request: ConfirmRequest, history: VerificationHistory): Promise<Confirmation> {
  const { candidate } = history
  const review = await describeVerification(tx, invoice, history)
  if (!candidate || review?.candidateId !== request.candidateId)
    throw new CentralInvoiceProblem('conflict', '核验候选已变化，请重新读取原件核验。')
  if (review.state === 'different')
    throw new CentralInvoiceProblem('conflict', '识别与归档票面有差异，请先通过更正单处理，再重新核对。')
  if (review.state !== 'ready')
    throw new CentralInvoiceProblem('conflict', '核验证据缺页、字段不足、已确认或已失效，请核对当前候选。')
  const correction = await effectiveCorrection(tx, invoice, candidate)
  if (correction === undefined)
    return corrupt()
  return { request, candidateSha256: candidate.sha256, checkedSha256: checkedDigest(invoice), printCount: invoice.printCount, correction }
}

function readEvidence(row: Row) {
  try {
    const evidence = JSON.parse(row.evidence_json) as VerificationEvidence
    const receipt = JSON.parse(row.result_json) as CentralInvoiceCommandResult
    const { request } = evidence
    const sha256 = commandFingerprint(evidence)
    const confirmation = request.action === CONFIRM_ORIGINAL_VERIFICATION
    if ((!confirmation && request.action !== RECORD_ORIGINAL_VERIFICATION)
      || row.action !== request.action || request.commandId !== row.command_id || request.invoiceId !== row.invoice_id
      || !Number.isSafeInteger(row.invoice_version) || Number(request.baseVersion) + 1 !== row.invoice_version
      || request.originalId !== row.original_id || !/^[a-f0-9]{64}$/.test(request.originalSha256)
      || row.candidate_id !== ('candidateId' in request ? request.candidateId : null)
      || receipt.commandId !== row.command_id || receipt.invoiceId !== row.invoice_id || receipt.originalId !== row.original_id
      || receipt.version !== String(row.invoice_version) || receipt.verificationSha256 !== sha256 || row.fingerprint !== commandFingerprint(request)) {
      return corrupt()
    }
    return { version: row.invoice_version, sha256, evidence }
  }
  catch { return corrupt() }
}

export function appendVerification(history: VerificationHistory, row: Row) {
  const saved = readEvidence(row)
  if (saved.evidence.request.action === RECORD_ORIGINAL_VERIFICATION) {
    history.candidate = saved as Saved<Candidate>
    delete history.confirmation
  }
  else {
    if (history.candidate?.evidence.request.commandId !== row.candidate_id)
      return corrupt()
    history.confirmation = saved as Saved<Confirmation>
  }
}

const SELECT_VERIFICATION = `SELECT v.*,r.result_json,r.action,r.fingerprint FROM invoice_original_verifications v
  JOIN invoice_command_receipts r ON r.command_id=v.command_id`

export async function readVerificationHistory(tx: SelectDb, invoiceId: string): Promise<VerificationHistory> {
  const rows = await tx.select<Row>(`${SELECT_VERIFICATION} WHERE v.invoice_id=? ORDER BY v.invoice_version DESC LIMIT 2`, [invoiceId])
  const history: VerificationHistory = {}
  const latest = rows[0]
  if (latest?.candidate_id) {
    const candidate = rows[1]
    if (candidate?.command_id !== latest.candidate_id)
      return corrupt()
    appendVerification(history, candidate)
  }
  if (latest)
    appendVerification(history, latest)
  return history
}

export async function loadVerificationAudit(tx: SelectDb): Promise<Map<string, Row>> {
  const rows = await tx.select<Row>(SELECT_VERIFICATION)
  return new Map(rows.map(row => [row.command_id, row]))
}
