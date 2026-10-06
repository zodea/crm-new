import type { FileRefChanges, FileRefRecord } from '../forms/file-refs'
import type { F3SaveResult } from './forms'
import { loadFileRefContent } from '../forms/file-refs'

export async function financeFileHash(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer))
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Verify the actual newly persisted bytes; historical metadata-only files do not acquire invented content. */
export async function verifyFinanceAttachments(result: Pick<F3SaveResult, 'id' | 'attachmentIds'>, changes: FileRefChanges, files: readonly FileRefRecord[], isCurrent: () => boolean, contentReader: typeof loadFileRefContent = loadFileRefContent): Promise<void> {
  const current = () => {
    if (!isCurrent())
      throw new DOMException('原件读取不属于当前页面。', 'AbortError')
  }
  const added = changes.add ?? []
  if (result.attachmentIds.length !== added.length || new Set(result.attachmentIds).size !== added.length)
    throw new Error('已保存原件回执与本次附件不一致，请只重试读取')
  for (const [index, sent] of added.entries()) {
    current()
    const file = files.find(file => file.id === result.attachmentIds[index])
    if (!file || file.ownerId !== result.id || file.deletedAt || file.fileName !== sent.fileName || typeof sent.payloadBase64 !== 'string')
      throw new Error('已保存原件身份或正文尚未可靠读取')
    const content = await contentReader(file)
    current()
    if (!content)
      throw new Error('已保存的新原件正文尚未可靠读取')
    const binary = atob(sent.payloadBase64)
    const expected = Uint8Array.from(binary, char => char.charCodeAt(0))
    const [actualHash, expectedHash] = await Promise.all([financeFileHash(content.bytes), financeFileHash(expected)])
    current()
    if (content.bytes.byteLength !== expected.byteLength || file.fileSize !== expected.byteLength || actualHash !== expectedHash)
      throw new Error('已保存原件大小或摘要与本次提交不一致，请保留输入')
  }
}
