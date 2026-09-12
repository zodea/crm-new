import type { OcrRecognitionResult } from '../../app/lib/recognize/engine'
import type { SupplierCredentialRecognition } from '../../app/lib/supplier/credential-contract'
import type { StoredSupplierCredential, StoredSupplierCredentialFile } from '../../app/lib/supplier/credential-domain'
import type { CredentialOcrFieldKey, ParsedCredentialOcr } from '../../app/lib/supplier/credential-ocr'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { CREDENTIAL_OCR_FIELD_KEYS, parseCredentialOcr } from '../../app/lib/supplier/credential-ocr'

const keys: readonly string[] = CREDENTIAL_OCR_FIELD_KEYS
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 历史投影不写入事实：候选仍绑定原 JSON 与当前可读原件，确认时须重新派生并核对。 */
export function supplierCredentialRecognition(target: StoredSupplierCredential, file?: StoredSupplierCredentialFile): SupplierCredentialRecognition | null {
  if (target.recognition)
    return structuredClone(target.recognition)
  const raw = target.ocrResult
  if (!file || file.deletedAt !== null || file.payloadBase64 === null || !Object.keys(raw).length)
    return null
  const bytes = Buffer.from(file.payloadBase64, 'base64')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.toString('base64') !== file.payloadBase64 || bytes.length !== file.fileSize || (file.sha256 && sha256 !== file.sha256))
    return null
  let parsed: ParsedCredentialOcr
  if (Array.isArray(raw.fields)) {
    if (!raw.fields.every(field => object(field) && keys.includes(String(field.key)) && typeof field.value === 'string'))
      return null
    parsed = { rawText: typeof raw.rawText === 'string' ? raw.rawText : '', category: { category: target.category, confidence: target.ocrConfidence ?? 0, evidence: ['历史结构化候选，原字段意义保留'] }, longTerm: target.longTerm, fields: raw.fields.map((value, index) => {
      const field = value as Record<string, unknown>
      return { id: `legacy-${field.key}-${index}`, key: field.key as CredentialOcrFieldKey, label: typeof field.label === 'string' ? field.label : String(field.key), sourceLabel: typeof field.sourceLabel === 'string' ? field.sourceLabel : typeof field.label === 'string' ? field.label : String(field.key), value: field.value as string, confidence: typeof field.confidence === 'number' && field.confidence >= 0 && field.confidence <= 1 ? field.confidence : 0 }
    }) }
  }
  else if (Array.isArray(raw.markdownPages) && raw.markdownPages.every(page => typeof page === 'string')) {
    parsed = parseCredentialOcr(raw as unknown as OcrRecognitionResult, file.fileName)
  }
  else { return null }
  const id = `history-${createHash('sha256').update(JSON.stringify([target.supplierId, target.id, file.id, sha256, raw])).digest('hex')}`
  return { id, fileId: file.id, sha256, recognizedAt: '', historical: true, result: structuredClone(raw), parsed }
}
