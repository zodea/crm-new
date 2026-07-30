const MAX_CREDENTIAL_FILE_BYTES = 20 * 1024 * 1024

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

export async function assertSupplierCredentialUpload(file: File): Promise<void> {
  if (file.size > MAX_CREDENTIAL_FILE_BYTES)
    throw new Error('单份证照不能超过 20 MB')

  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension
  const rule = SUPPORTED_TYPES[normalizedExtension as keyof typeof SUPPORTED_TYPES]
  if (!rule)
    throw new Error('证照仅支持 PDF、PNG、JPG/JPEG')
  if (!(rule.mimeTypes as readonly string[]).includes(file.type.toLowerCase()))
    throw new Error('证照扩展名与文件类型不匹配')

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (!matchesSignature(header, rule.signature))
    throw new Error('证照文件内容与扩展名不匹配')
}
