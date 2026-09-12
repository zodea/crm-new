import type { SupplierCredentialRecord, SupplierCredentialSnapshot } from '~/lib/supplier/credential-contract'
import { defaultCredentialRequirement, SUPPLIER_CREDENTIAL_CATEGORIES } from '~/lib/supplier/credentials'

export function credentialRecord(overrides: Partial<SupplierCredentialRecord> = {}): SupplierCredentialRecord {
  return { id: 'credential-a', supplierId: 'supplier-a', category: '营业执照', validFrom: '', expiresAt: '', longTerm: false, file: { id: 'file-a', ownerType: 'supplier_credential', ownerId: 'credential-a', fileName: '合成营业执照.pdf', fileSize: 12, mimeType: 'application/pdf', state: 'available' }, legacyFilePath: '', ocrResult: {}, ocrConfidence: null, ocrConfirmedResult: {}, ocrConfirmedAt: null, ocrReviewStatus: 'not_started', verifiedAt: null, addedAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z', ...overrides }
}
export function credentialSnapshot(overrides: Partial<SupplierCredentialSnapshot> = {}): SupplierCredentialSnapshot {
  return { dataOrigin: 'real', supplierId: 'supplier-a', supplierName: '合成分供方 A', supplierVersion: 'supplier-v1', credentialVersion: 'credential-v1', workspaceId: 'workspace-a', actorId: 'actor-a', capabilities: ['supplier-credential:read', 'supplier-credential:write'], asOf: '2026-09-12T00:00:00Z', businessDate: '2026-09-12', status: 'incomplete', review: null, credentials: [], requirements: SUPPLIER_CREDENTIAL_CATEGORIES.map(category => ({ id: null, category, requirement: defaultCredentialRequirement(category), reason: '', updatedAt: null })), audits: [], ...overrides }
}
