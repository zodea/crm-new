import type { CentralInvoiceOriginalInput } from './central-contract'
import { CentralInvoiceProblem, INVOICE_ORIGINAL_MAX_BYTES } from './central-contract'

/** 只在页面内准备原始字节，禁止把内容或票面放进浏览器恢复记录。 */
export async function prepareInvoiceOriginal(file: File): Promise<CentralInvoiceOriginalInput> {
  const invalid = () => {
    throw new CentralInvoiceProblem('validation-failed', '请选择不超过 10 MiB 的 PDF、PNG 或 JPEG 原件。')
  }
  if (!file.name.trim() || file.name.length > 240 || /[/\\]/.test(file.name)
    || Array.from(file.name).some(character => (character.codePointAt(0) ?? 0) < 32)
    || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > INVOICE_ORIGINAL_MAX_BYTES) {
    return invalid()
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length !== file.size)
    return invalid()
  const name = file.name.toLowerCase()
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  const pdf = name.endsWith('.pdf') && starts([37, 80, 68, 70, 45])
  const png = name.endsWith('.png') && starts([137, 80, 78, 71, 13, 10, 26, 10])
  const jpeg = /\.jpe?g$/.test(name) && starts([255, 216, 255])
  if (!pdf && !png && !jpeg)
    return invalid()
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return { fileName: file.name.trim(), fileSize: file.size, mimeType: pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg', contentBase64: btoa(binary) }
}
