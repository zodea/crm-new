import type { ContractFormAttachment, ContractFormAttachmentDraft } from '../../app/lib/contract/forms'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

export const CONTRACT_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024
export const contractOriginalDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** 公共原件边界：正文存在性、规范编码、长度和限额；领域自行提供错误。 */
export function contractOriginalBytes(file: ContractFormAttachmentDraft, options: { required?: boolean, fail: (message: string) => never }): Uint8Array | null {
  if (typeof file.payloadBase64 !== 'string')
    return options.required ? options.fail('合同原件须提供真实正文，不能仅保存本机路径。') : null
  if (!file.fileName.trim() || !Number.isSafeInteger(file.fileSize) || file.fileSize! < 0 || file.fileSize! > CONTRACT_ORIGINAL_MAX_BYTES
    || file.payloadBase64.length > Math.ceil(CONTRACT_ORIGINAL_MAX_BYTES / 3) * 4) {
    return options.fail('合同原件大小无效，单份不能超过 10 MiB。')
  }
  const bytes = Buffer.from(file.payloadBase64, 'base64')
  if (bytes.toString('base64') !== file.payloadBase64 || bytes.length !== file.fileSize)
    return options.fail('合同原件正文、大小或编码不一致。')
  return bytes
}

/** 路径只作历史证据；同图真实正文必须独立核验，缺件不能据此捏造空正文。 */
export function contractMigratedAttachments(value: unknown, options: { ownerId: string, legacyOwnerId?: string, ownerType?: 'contract' | 'contract_supplement', allocatedIds: Set<string>, originals: Map<string, { bytes: Uint8Array, sha256: string }>, fail: (message: string) => never }): ContractFormAttachment[] {
  let rows: unknown
  try {
    rows = typeof value === 'string' ? JSON.parse(value) : value
  }
  catch { return options.fail('旧合同附件元数据不是有效 JSON，不能迁入。') }
  if (!Array.isArray(rows))
    return options.fail('旧合同附件元数据不是完整集合，不能迁入。')
  return rows.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return options.fail('旧合同附件元数据损坏，不能迁入。')
    const file = entry as Record<string, unknown>
    if (typeof file.id !== 'string' || !file.id.trim() || options.allocatedIds.has(file.id)
      || file.ownerType !== (options.ownerType ?? 'contract') || (file.ownerId !== options.ownerId && file.ownerId !== options.legacyOwnerId)
      || typeof file.fileName !== 'string' || !file.fileName.trim()
      || !Number.isSafeInteger(file.fileSize) || Number(file.fileSize) < 0
      || (file.deletedAt !== null && typeof file.deletedAt !== 'string')
      || ['filePath', 'mimeType', 'category', 'uploader', 'uploadedAt'].some(key => file[key] !== null && typeof file[key] !== 'string')) {
      return options.fail('旧合同附件身份、归属、大小或历史元数据损坏，不能迁入。')
    }
    options.allocatedIds.add(file.id)
    if (file.payloadEncoding !== undefined && file.payloadEncoding !== null && file.payloadEncoding !== 'base64')
      return options.fail('旧合同附件正文编码不受支持，原件须保留在原来源核对。')
    let sha256: string | undefined
    if (file.payloadBase64 !== undefined && file.payloadBase64 !== null) {
      const bytes = contractOriginalBytes({ fileName: file.fileName, fileSize: Number(file.fileSize), payloadBase64: file.payloadBase64 as string }, { required: true, fail: options.fail })!
      sha256 = contractOriginalDigest(bytes)
      options.originals.set(file.id, { bytes, sha256 })
    }
    return {
      id: file.id,
      ownerType: options.ownerType ?? 'contract',
      ownerId: options.ownerId,
      fileName: file.fileName,
      filePath: typeof file.filePath === 'string' ? file.filePath : '',
      fileSize: Number(file.fileSize),
      mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
      category: typeof file.category === 'string' ? file.category : '',
      uploader: typeof file.uploader === 'string' ? file.uploader : '',
      uploadedAt: typeof file.uploadedAt === 'string' ? file.uploadedAt : '',
      deletedAt: file.deletedAt as string | null,
      ...(sha256 ? { sha256 } : {}),
    }
  })
}
