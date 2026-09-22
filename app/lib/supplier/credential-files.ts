export const MAX_CREDENTIAL_FILE_BYTES = 20 * 1024 * 1024

const SUPPORTED_TYPES = {
  pdf: {
    mimeTypes: ['application/pdf'],
    signature: [0x25, 0x50, 0x44, 0x46],
  },
  png: {
    mimeTypes: ['image/png'],
    signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  },
  jpg: {
    mimeTypes: ['image/jpeg'],
    signature: [0xFF, 0xD8, 0xFF],
  },
} as const

function matchesSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

/** 共享文件政策；各入口独立提供已核实的大小与正文头，不信任客户端的校验结果。 */
export function assertSupplierCredentialFile(file: { fileName: string, fileSize: number, mimeType: string }, header: Uint8Array): void {
  if (!Number.isSafeInteger(file.fileSize) || file.fileSize < 1 || file.fileSize > MAX_CREDENTIAL_FILE_BYTES)
    throw new Error('证照原件不能为空，且单份不能超过 20 MB')

  const extension = file.fileName.split('.').pop()?.toLowerCase() ?? ''
  const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension
  const rule = SUPPORTED_TYPES[normalizedExtension as keyof typeof SUPPORTED_TYPES]
  if (!rule)
    throw new Error('证照仅支持 PDF、PNG、JPG/JPEG')
  if (!(rule.mimeTypes as readonly string[]).includes(file.mimeType.toLowerCase()))
    throw new Error('证照扩展名与文件类型不匹配')

  if (!matchesSignature(header, rule.signature))
    throw new Error('证照文件内容签名与扩展名不一致')
}

export async function assertSupplierCredentialUpload(file: File): Promise<void> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  assertSupplierCredentialFile({ fileName: file.name, fileSize: file.size, mimeType: file.type }, header)
}
