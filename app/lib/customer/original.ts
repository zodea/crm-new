import type { FormAttachmentDraft } from '../master-data/forms'

export async function customerOriginal(file: File): Promise<FormAttachmentDraft> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error('客户原件单份不能超过 10 MiB。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
  return { fileName: file.name, fileSize: bytes.length, mimeType: file.type, contentBase64: btoa(binary) }
}
