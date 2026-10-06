import type { FinanceExpenseReference } from './expense-reference'

export interface ExpenseClearanceLine {
  id: string
  headerId: string
  originalExpenseLineId: string
  amount: number | null
  status: string
  deletedAt: string | null
  headerDeletedAt: string | null
  sourceVersion: string | null
  missingOriginalDocument: boolean
  originalDocumentState: 'not-digitized' | 'readable' | 'missing-body'
  declaredMissingOriginals?: Array<{ id: string, fileName: string, filePath: string, fileSize: number | null, reason: string }>
}
export interface ExpenseClearanceVerificationItemEdit {
  id?: string
  sourceClearanceLineId: string | null
  amount: number
  matchBasis: string
}
export interface ExpenseClearanceExistingBindingEdit {
  expenseAllocationId: string
  itemIndex: number
  amount: number
}
export interface ExpenseClearanceVerificationEdit {
  originalExpenseLineId: string
  sourceVersion: string
  sourceHash: string
  basis: string
  fileIds: string[]
  items: ExpenseClearanceVerificationItemEdit[]
  existingBindings: ExpenseClearanceExistingBindingEdit[]
}
export interface ExpenseClearanceVerificationItem {
  id: string
  sourceClearanceLineId: string | null
  amount: number
  matchBasis: string
  missingOriginalDocument: boolean
}
export interface ExpenseClearanceOriginal {
  id: string
  ownerType: string
  ownerId: string
  fileName: string
  fileSize: number
  sha256: string
}
export interface ExpenseClearanceProof {
  schemaVersion: 'expense-clearance-verification-v1'
  id: string
  originalExpenseLineId: string
  headerId: string
  expenseVersion: string
  sourceHash: string
  workspaceId: string
  actorId: string
  verifiedAt: string
  commandId: string
  basis: string
  items: ExpenseClearanceVerificationItem[]
  originals: ExpenseClearanceOriginal[]
  sourceSnapshot: unknown
}
export interface ExpenseClearanceAllocationInput { verificationId: string, itemId: string, amount: number }
export interface ExpenseClearanceLinkEdit {
  verificationId: string
  bindings: Array<{ expenseAllocationId: string, itemId: string, amount: number }>
}
export interface ExpenseClearanceLink {
  id: string
  expenseAllocationId: string
  settlementId: string
  originalExpenseLineId: string
  verificationId: string
  itemId: string
  amount: number
  createdAt: string
  actorId: string
}
export interface ExpenseClearanceQualification {
  state: 'not-required' | 'missing' | 'verified' | 'stale' | 'unavailable'
  message: string
  verificationId: string | null
  recordedHandledAmount: number
  verifiedHandledAmount: number | null
  confirmedOtherAdoptedAmount: number | null
  verifiedOverlapAmount: number | null
  newAdoptableAmount: number | null
  legacyObligationAmount: number | null
  legacyPaidAmount: number | null
  legacyUnpaidAmount: number | null
}
export interface ExpenseClearanceSourceDTO extends FinanceExpenseReference {
  clearances: ExpenseClearanceLine[]
  clearanceSourceHash: string
  qualification: ExpenseClearanceQualification
  clearanceProofs: ExpenseClearanceProof[]
  clearanceLinks: ExpenseClearanceLink[]
  clearanceItemAvailability: Array<{ verificationId: string, itemId: string, amountRemaining: number | null }>
}
export interface ExpenseClearanceVerificationState {
  status: ExpenseClearanceQualification['state']
  message: string
  sources: ExpenseClearanceSourceDTO[]
  proofs: ExpenseClearanceProof[]
}

export interface ExpenseClearanceAllocationDTO { id: string, originalExpenseLineId: string, amount: number | null, sourceVersion: string, sourceRevision: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 10000
}
function money(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e12 && Math.abs(value * 100 - Math.round(value * 100)) < 0.001
}
function sourceMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key))
}
export function isExpenseClearanceVerificationEdit(value: unknown): value is ExpenseClearanceVerificationEdit {
  return record(value) && exact(value, ['originalExpenseLineId', 'sourceVersion', 'sourceHash', 'basis', 'fileIds', 'items', 'existingBindings'])
    && text(value.originalExpenseLineId) && text(value.sourceVersion) && typeof value.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(value.sourceHash) && text(value.basis)
    && Array.isArray(value.fileIds) && value.fileIds.length > 0 && value.fileIds.length <= 100 && value.fileIds.every(text) && new Set(value.fileIds).size === value.fileIds.length
    && Array.isArray(value.items) && value.items.length > 0 && value.items.length <= 1000 && value.items.every(item => record(item) && exact(item, ['sourceClearanceLineId', 'amount', 'matchBasis'], ['id']) && (item.id === undefined || text(item.id)) && (item.sourceClearanceLineId === null || text(item.sourceClearanceLineId)) && money(item.amount) && text(item.matchBasis))
    && Array.isArray(value.existingBindings) && value.existingBindings.length <= 1000 && value.existingBindings.every(binding => record(binding) && exact(binding, ['expenseAllocationId', 'itemIndex', 'amount']) && text(binding.expenseAllocationId) && typeof binding.itemIndex === 'number' && Number.isInteger(binding.itemIndex) && binding.itemIndex >= 0 && binding.itemIndex < (value.items as unknown[]).length && money(binding.amount))
}
export function isExpenseClearanceAllocationInput(value: unknown): value is ExpenseClearanceAllocationInput {
  return record(value) && exact(value, ['verificationId', 'itemId', 'amount']) && text(value.verificationId) && text(value.itemId) && money(value.amount)
}
export function isExpenseClearanceLinkEdit(value: unknown): value is ExpenseClearanceLinkEdit {
  return record(value) && exact(value, ['verificationId', 'bindings']) && text(value.verificationId) && Array.isArray(value.bindings) && value.bindings.length > 0 && value.bindings.length <= 1000 && value.bindings.every(binding => record(binding) && exact(binding, ['expenseAllocationId', 'itemId', 'amount']) && text(binding.expenseAllocationId) && text(binding.itemId) && money(binding.amount))
}

export function isExpenseClearanceLink(value: unknown): value is ExpenseClearanceLink {
  return record(value) && ['id', 'expenseAllocationId', 'settlementId', 'originalExpenseLineId', 'verificationId', 'itemId', 'createdAt', 'actorId'].every(key => text(value[key])) && money(value.amount)
}
export function isExpenseClearanceProof(value: unknown): value is ExpenseClearanceProof {
  return record(value) && value.schemaVersion === 'expense-clearance-verification-v1' && ['id', 'originalExpenseLineId', 'headerId', 'expenseVersion', 'workspaceId', 'actorId', 'verifiedAt', 'commandId', 'basis'].every(key => text(value[key]))
    && typeof value.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(value.sourceHash) && Object.hasOwn(value, 'sourceSnapshot')
    && Array.isArray(value.items) && value.items.length > 0 && value.items.every(item => record(item) && text(item.id) && (item.sourceClearanceLineId === null || text(item.sourceClearanceLineId)) && money(item.amount) && text(item.matchBasis) && typeof item.missingOriginalDocument === 'boolean')
    && new Set(value.items.map(item => (item as ExpenseClearanceVerificationItem).id)).size === value.items.length
    && Array.isArray(value.originals) && value.originals.length > 0 && value.originals.every(file => record(file) && ['id', 'ownerType', 'ownerId', 'fileName'].every(key => text(file[key])) && typeof file.fileSize === 'number' && Number.isSafeInteger(file.fileSize) && file.fileSize >= 0 && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256))
}
export function isExpenseClearanceSourceDTO(value: unknown): value is ExpenseClearanceSourceDTO {
  if (!record(value) || !['id', 'headerId', 'version', 'sourceRevision', 'expenseItem', 'serviceSupplierId', 'serviceSupplierNameSnapshot', 'applicantNameSnapshot'].every(key => text(value[key])) || !sourceMoney(value.amount)
    || !(value.projectId === null || text(value.projectId)) || !(value.applicantWorkerId === null || text(value.applicantWorkerId)) || !(value.applicantSupplierId === null || text(value.applicantSupplierId)) || Boolean(value.applicantWorkerId) === Boolean(value.applicantSupplierId)
    || typeof value.clearedAmount !== 'number' || !Number.isFinite(value.clearedAmount) || value.clearedAmount < 0 || value.clearedAmount > value.amount
    || typeof value.clearanceSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.clearanceSourceHash) || !Array.isArray(value.clearanceProofs) || !value.clearanceProofs.every(isExpenseClearanceProof) || !Array.isArray(value.clearanceLinks) || !value.clearanceLinks.every(isExpenseClearanceLink)
    || !Array.isArray(value.clearanceItemAvailability) || !value.clearanceItemAvailability.every(item => record(item) && text(item.verificationId) && text(item.itemId) && (item.amountRemaining === null || (typeof item.amountRemaining === 'number' && Number.isFinite(item.amountRemaining) && item.amountRemaining >= 0)))) {
    return false
  }
  if (!Array.isArray(value.clearances) || !value.clearances.every(line => record(line) && ['id', 'headerId', 'originalExpenseLineId', 'status'].every(key => typeof line[key] === 'string') && (line.amount === null || sourceMoney(line.amount)) && (line.sourceVersion === null || text(line.sourceVersion)) && [line.deletedAt, line.headerDeletedAt].every(item => item === null || typeof item === 'string') && typeof line.missingOriginalDocument === 'boolean' && ['not-digitized', 'readable', 'missing-body'].includes(String(line.originalDocumentState))))
    return false
  const q = value.qualification
  return record(q) && ['not-required', 'missing', 'verified', 'stale', 'unavailable'].includes(String(q.state)) && typeof q.message === 'string' && (q.verificationId === null || text(q.verificationId))
    && typeof q.recordedHandledAmount === 'number' && Number.isFinite(q.recordedHandledAmount) && q.recordedHandledAmount >= 0
    && ['verifiedHandledAmount', 'confirmedOtherAdoptedAmount', 'verifiedOverlapAmount', 'newAdoptableAmount', 'legacyObligationAmount', 'legacyPaidAmount', 'legacyUnpaidAmount'].every(key => q[key] === null || (typeof q[key] === 'number' && Number.isFinite(q[key]) && q[key] >= 0))
}
export function isExpenseClearanceVerificationState(value: unknown): value is ExpenseClearanceVerificationState {
  return record(value) && ['not-required', 'missing', 'verified', 'stale', 'unavailable'].includes(String(value.status)) && typeof value.message === 'string' && Array.isArray(value.sources) && value.sources.every(isExpenseClearanceSourceDTO) && Array.isArray(value.proofs) && value.proofs.every(isExpenseClearanceProof)
}
