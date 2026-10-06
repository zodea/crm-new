import type { TransactionDb } from '../db/coordinator'
import { isISODateTimeDTO } from '../../types/read-model'
import { FinanceAmountSourceError } from './persistent-rows'

export interface PaymentVerificationEdit {
  actualDueAmount: number
  cumulativePayableAmount: number
  basis: string
  fileIds: string[]
}
export interface PaymentVerificationInput {
  actualDueAmount: string
  cumulativePayableAmount: string
  basis: string
  fileIds: string[]
}
export interface PaymentVerificationSource {
  owner: 'other-settlements' | 'finance-expense'
  id: string
  version: string
  sourceVersion: string
  fingerprint: string
  evidenceJson: string
}
export interface PaymentVerificationOriginal {
  id: string
  ownerType: string
  ownerId: string
  fileName: string
  fileSize: number
  sha256: string
}
export interface PaymentVerificationProof extends PaymentVerificationEdit {
  schemaVersion: 'payment-verification-v1'
  applicationId: string
  applicationVersion: string
  commandId: string
  workspaceId: string
  actorId: string
  verifiedAt: string
  applicationSnapshotSha256: string
  sources: PaymentVerificationSource[]
  originals: PaymentVerificationOriginal[]
}
export interface PaymentVerificationState {
  required: boolean
  status: 'not-required' | 'missing' | 'verified' | 'stale' | 'unavailable'
  message: string
  proof: PaymentVerificationProof | null
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,99}$/i.test(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function isPaymentVerificationEdit(value: unknown): value is PaymentVerificationEdit {
  return object(value) && Object.keys(value).every(key => ['actualDueAmount', 'cumulativePayableAmount', 'basis', 'fileIds'].includes(key))
    && amount(value.actualDueAmount) && amount(value.cumulativePayableAmount) && value.cumulativePayableAmount <= value.actualDueAmount
    && text(value.basis) && value.basis.length <= 2000 && Array.isArray(value.fileIds) && value.fileIds.length > 0 && value.fileIds.length <= 50
    && value.fileIds.every(id) && new Set(value.fileIds).size === value.fileIds.length
}
export function isPaymentVerificationProof(value: unknown): value is PaymentVerificationProof {
  if (!object(value) || value.schemaVersion !== 'payment-verification-v1' || !id(value.applicationId) || !id(value.commandId)
    || typeof value.applicationVersion !== 'string' || !/^[1-9]\d*$/.test(value.applicationVersion)
    || !text(value.workspaceId) || !text(value.actorId) || !isISODateTimeDTO(value.verifiedAt)
    || !hash(value.applicationSnapshotSha256) || !Array.isArray(value.fileIds) || !isPaymentVerificationEdit({ actualDueAmount: value.actualDueAmount, cumulativePayableAmount: value.cumulativePayableAmount, basis: value.basis, fileIds: value.fileIds })
    || !Array.isArray(value.sources) || !value.sources.length || !Array.isArray(value.originals) || value.originals.length !== value.fileIds.length) {
    return false
  }
  const fileIds = value.fileIds
  return value.sources.every((source) => {
    if (!object(source) || !['other-settlements', 'finance-expense'].includes(String(source.owner)) || !id(source.id) || typeof source.version !== 'string' || !/^(?:0|[1-9]\d*)$/.test(source.version) || !text(source.sourceVersion) || !hash(source.fingerprint) || !text(source.evidenceJson))
      return false
    try {
      const evidence: unknown = JSON.parse(source.evidenceJson)
      return object(evidence) && evidence.id === source.id && evidence.version === source.version && hash(evidence.ownerSnapshotSha256)
        && source.sourceVersion === `${source.owner === 'finance-expense' ? 'finance-record' : 'other-settlement-record'}-${source.version}`
        && (source.owner !== 'finance-expense' || source.version !== '0')
    }
    catch { return false }
  })
  && value.originals.every(original => object(original) && id(original.id) && fileIds.includes(original.id) && original.ownerType === 'payment_application' && original.ownerId === value.applicationId && text(original.fileName) && Number.isSafeInteger(original.fileSize) && Number(original.fileSize) >= 0 && hash(original.sha256))
  && new Set(value.originals.map(original => original.id)).size === value.originals.length
}
export function isPaymentVerificationState(value: unknown, applicationId: string): value is PaymentVerificationState {
  return object(value) && typeof value.required === 'boolean' && typeof value.message === 'string'
    && ['not-required', 'missing', 'verified', 'stale', 'unavailable'].includes(String(value.status))
    && (value.proof === null || (isPaymentVerificationProof(value.proof) && value.proof.applicationId === applicationId))
    && (value.status === 'not-required' ? !value.required && value.proof === null : value.required)
    && (value.status === 'verified' ? value.proof !== null : value.proof === null)
}
function legacyUnknown(value: unknown): boolean {
  if (!object(value))
    return false
  return (value.approved_amount === 0 && value.approved_amount_origin !== 'user-entry')
    || (value.approvedAmount === 0 && value.approvedAmountOrigin !== 'user-entry')
}
function storedObject(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : null
    if (object(parsed))
      return parsed
  }
  catch {}
  throw new FinanceAmountSourceError('历史批复原证据损坏，请核对原库与备份，不能以当前输入替代。')
}
/** Editing the current zero/origin never erases the requirement proven by the original history. */
export async function requiresPaymentVerification(tx: Pick<TransactionDb, 'select'>, applicationId: string): Promise<boolean> {
  const current = (await tx.select<Record<string, unknown>>('SELECT * FROM payment_applications WHERE id=?', [applicationId]))[0]
  if (legacyUnknown(current))
    return true
  const logs = await tx.select<{ before_data: unknown, after_data: unknown }>('SELECT before_data,after_data FROM operation_logs WHERE table_name=\'payment_applications\' AND record_id=?', [applicationId])
  for (const log of logs) {
    for (const value of [log.before_data, log.after_data]) {
      if (value !== null && value !== undefined && legacyUnknown(storedObject(value)))
        return true
    }
  }
  const tables = await tx.select<{ name: string }>('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name=\'finance_history\'')
  if (tables.length) {
    const history = await tx.select<{ snapshot_json: string }>('SELECT snapshot_json FROM finance_history WHERE kind=\'payment_application\' AND id=? ORDER BY version', [applicationId])
    for (const row of history) {
      if (legacyUnknown(storedObject(row.snapshot_json).head))
        return true
    }
  }
  return false
}
