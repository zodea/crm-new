import type { SupplierCredentialAction } from './credential-contract'
import type { SupplierCredentialCategory, SupplierCredentialRequirement } from './credentials'

export interface SupplierCredentialFormValue {
  category: SupplierCredentialCategory
  validFrom: string
  expiresAt: string
  longTerm: boolean
  requirement: SupplierCredentialRequirement
  reason: string
  decision: 'qualified' | 'rejected'
  note: string
}
export type SupplierCredentialEditorMode = SupplierCredentialAction['action']
export function emptySupplierCredentialForm(): SupplierCredentialFormValue {
  return { category: '营业执照', validFrom: '', expiresAt: '', longTerm: false, requirement: 'required', reason: '', decision: 'qualified', note: '' }
}
export const SUPPLIER_CREDENTIAL_REQUIREMENT_LABELS = { required: '需提供', optional: '可选', not_applicable: '不适用' } as const
