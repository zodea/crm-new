import type { DataOriginDTO } from '../../types/read-model'

export interface ContractOriginalContent {
  ownerId: string
  fileId: string
  dataOrigin: 'real'
  fileName: string
  mimeType: string
  fileSize: number
  sha256: string
  payloadBase64: string
}

/** 同一规范正文检查供 HTTP 解码及 Native 事务保存复用。 */
export async function contractOriginalPayloadDigest(payload: string, fileSize: number, invalid: () => never): Promise<string> {
  if (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > 10 * 1024 * 1024
    || payload.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || payload.length % 4 || !/^[A-Z0-9+/]*={0,2}$/i.test(payload)) {
    return invalid()
  }
  let binary: string
  try {
    binary = atob(payload)
  }
  catch {
    return invalid()
  }
  if (btoa(binary) !== payload || binary.length !== fileSize)
    return invalid()
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function decodeContractOriginalContent(
  value: unknown,
  expected: { ownerId: string, fileId: string, origin: DataOriginDTO },
  invalid: () => never,
): Promise<ContractOriginalContent> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return invalid()
  const content = value as Record<string, unknown>
  if (expected.origin !== 'real' || content.dataOrigin !== 'real'
    || content.ownerId !== expected.ownerId || content.fileId !== expected.fileId
    || typeof content.fileName !== 'string' || !content.fileName.trim()
    || typeof content.mimeType !== 'string' || typeof content.payloadBase64 !== 'string'
    || !Number.isSafeInteger(content.fileSize) || Number(content.fileSize) < 0
    || Number(content.fileSize) > 10 * 1024 * 1024
    || typeof content.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(content.sha256)) {
    return invalid()
  }
  const hash = await contractOriginalPayloadDigest(content.payloadBase64, Number(content.fileSize), invalid)
  if (hash !== content.sha256)
    return invalid()
  return content as unknown as ContractOriginalContent
}
