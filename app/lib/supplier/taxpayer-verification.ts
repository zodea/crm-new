import type { DataOriginDTO } from '../../types/read-model'
import type { SupplierFormDraft } from '../master-data/forms'
import type { SupplierCredentialCommandResult } from './credential-contract'
import { credentialProblem } from './credential-contract'

export const GUANGDONG_TAX_QUERY_URL = 'https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx'
export const TAXPAYER_TYPES = ['未核验', '一般纳税人', '小规模纳税人'] as const
export type TaxpayerType = typeof TAXPAYER_TYPES[number]
export const TAXPAYER_VERIFICATION_LABELS = { confirmed_general: '已确认一般纳税人', not_found: '官网未查到，保持未核验', manually_confirmed: '其他官方资料人工确认' } as const
export type TaxpayerVerificationStatus = keyof typeof TAXPAYER_VERIFICATION_LABELS
export interface TaxpayerVerificationDraft { status: TaxpayerVerificationStatus, taxpayerType: TaxpayerType, note: string }
export interface SupplierTaxpayerFields {
  taxpayerType: string
  taxpayerVerificationStatus: string
  taxpayerVerificationSource: string
  taxpayerVerifiedAt: string | null
  taxpayerVerificationNote: string
}
export interface SupplierTaxpayerCommand {
  supplierId: string
  origin: DataOriginDTO
  workspaceId: string
  actorId: string
  requiredCapability: 'supplier:write'
  commandId: string
  baseSupplierVersion: string
  expectedTaxNo: string
  draft: TaxpayerVerificationDraft
}
export interface SupplierTaxpayerResult extends SupplierCredentialCommandResult { verification: SupplierTaxpayerFields }

export function taxpayerFields(draft: SupplierFormDraft): SupplierTaxpayerFields {
  return { taxpayerType: draft.taxpayerType ?? '未核验', taxpayerVerificationStatus: draft.taxpayerVerificationStatus || 'not_checked', taxpayerVerificationSource: draft.taxpayerVerificationSource ?? '', taxpayerVerifiedAt: draft.taxpayerVerifiedAt ?? null, taxpayerVerificationNote: draft.taxpayerVerificationNote ?? '' }
}

/** 普通主档/OCR 只继承当前凭证；核验对象或分类变化时撤回旧凭证，绝不采用来稿凭证。 */
export function preserveTaxpayerVerification(before: SupplierFormDraft | null, after: SupplierFormDraft): SupplierFormDraft {
  const unchanged = before && (before.taxNo ?? '').trim() === (after.taxNo ?? '').trim() && (before.taxpayerType ?? '').trim() === (after.taxpayerType ?? '').trim()
  const proof = unchanged ? taxpayerFields(before) : { taxpayerVerificationStatus: 'not_checked', taxpayerVerificationSource: '', taxpayerVerifiedAt: null, taxpayerVerificationNote: '' }
  return { ...after, ...proof, taxpayerType: after.taxpayerType }
}

export function verifiedTaxpayerFields(draft: TaxpayerVerificationDraft, timestamp: string): SupplierTaxpayerFields {
  if (!Object.hasOwn(TAXPAYER_VERIFICATION_LABELS, draft.status) || !TAXPAYER_TYPES.includes(draft.taxpayerType) || typeof draft.note !== 'string' || draft.note.length > 10_000)
    throw credentialProblem('validation-failed', '请核对人工税务核验结果、类型和备注')
  return {
    taxpayerType: draft.status === 'confirmed_general' ? '一般纳税人' : draft.status === 'not_found' ? '未核验' : draft.taxpayerType,
    taxpayerVerificationStatus: draft.status,
    taxpayerVerificationSource: draft.status === 'manually_confirmed' ? '其他官方资料' : GUANGDONG_TAX_QUERY_URL,
    taxpayerVerifiedAt: timestamp,
    taxpayerVerificationNote: draft.note.trim(),
  }
}

/** 只更新专用动作已经保存的五字段，其他未保存草稿及其脏基准原样保留。 */
export function mergeTaxpayerVerification(draft: SupplierFormDraft, saved: SupplierFormDraft, verification: SupplierTaxpayerFields) {
  return { draft: { ...draft, ...verification }, saved: { ...saved, ...verification } }
}
