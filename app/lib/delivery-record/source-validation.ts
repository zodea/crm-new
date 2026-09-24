import type { DeliverySourceUpload } from './contract'

/** 迁移采证与中央上传共用字节校验；摘要仍由中央独立计算。 */
export function decodeDeliveryOriginal(source: DeliverySourceUpload): Uint8Array {
  const fail = (): never => {
    throw new Error('送货原件校验失败：类型、正文或长度无效')
  }
  if (!source || typeof source.fileName !== 'string' || !source.fileName.trim()
    || !['application/pdf', 'image/png', 'image/jpeg'].includes(source.mimeType)
    || !Number.isSafeInteger(source.fileSize) || source.fileSize <= 0
    || typeof source.payloadBase64 !== 'string' || source.payloadBase64.length % 4 !== 0
    || !/^[A-Z0-9+/]*={0,2}$/i.test(source.payloadBase64)) {
    fail()
  }
  let binary = ''
  try {
    binary = atob(source.payloadBase64)
  }
  catch { fail() }
  if (btoa(binary) !== source.payloadBase64 || binary.length !== source.fileSize)
    fail()
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const signature = source.mimeType === 'application/pdf'
    ? [...new TextEncoder().encode('%PDF-')]
    : source.mimeType === 'image/png'
      ? [137, 80, 78, 71, 13, 10, 26, 10]
      : [255, 216, 255]
  if (!signature.every((byte, index) => bytes[index] === byte))
    fail()
  return bytes
}
