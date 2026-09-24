import type { SupplierCredentialScope } from './supplier-credential-service'
import credentials from '../../app/lib/db/seed/supplier_credentials.json'
import suppliers from '../../app/lib/db/seed/suppliers.json'
import { credentialProblem } from '../../app/lib/supplier/credential-contract'
import { emptySupplierCredentialAggregate } from '../../app/lib/supplier/credential-domain'
import { canonicalCredentialCategory } from '../../app/lib/supplier/credentials'

/** 演示专用原始事实在中央读取；不存在正文的历史文件名仍明确显示缺正文。 */
export function supplierCredentialDemoScope(supplierId: string): SupplierCredentialScope {
  const supplier = suppliers.find(row => row.id === supplierId)
  if (!supplier)
    throw credentialProblem('not-found', '当前演示分供方不存在')
  const aggregate = emptySupplierCredentialAggregate(supplierId)
  for (const row of credentials.filter(row => row.supplier_id === supplierId)) {
    const fileRefId = `demo-credential-file:${row.id}`
    aggregate.credentials.push({ id: row.id, supplierId, category: canonicalCredentialCategory(row.category), fileRefId, legacyFilePath: row.file_path, validFrom: '', expiresAt: '', longTerm: false, ocrResult: JSON.parse(row.ocr_result), ocrConfidence: row.ocr_confidence, ocrConfirmedResult: {}, ocrConfirmedAt: null, ocrReviewStatus: 'not_started', verifiedAt: row.verified_at, addedAt: row.added_at, updatedAt: row.added_at, deletedAt: null, deletionToken: null, migrationBatchId: null, legacyId: row.id })
    aggregate.files.push({ id: fileRefId, ownerType: 'supplier_credential', ownerId: row.id, fileName: row.file_name, fileSize: 0, mimeType: '', payloadBase64: null, sha256: null, createdAt: row.added_at, deletedAt: null, migrationBatchId: null, legacyId: null })
  }
  return { draft: { name: supplier.name }, version: 1, aggregate }
}
