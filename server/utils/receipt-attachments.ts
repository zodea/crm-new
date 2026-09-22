import type { FileRefChanges, FileRefRecord } from '../../app/lib/forms/file-refs'
import type { ReceiptFileContent } from '../../app/lib/receipt/contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { receiptProblem } from '../../app/lib/receipt/contract'

export function prepareReceiptAttachments(options: {
  ownerId: string
  records: FileRefRecord[]
  payloads: Map<string, string>
  changes: FileRefChanges
  now: string
  actorId: string
  createId: () => string
}) {
  const { ownerId, changes, now, actorId, createId } = options
  const records = structuredClone(options.records)
  const payloads = new Map(options.payloads)
  const attachmentIds: string[] = []
  for (const key of ['add', 'removeIds', 'restoreIds'] as const) {
    if (changes[key] !== undefined && !Array.isArray(changes[key]))
      throw receiptProblem('validation-failed', '附件变更格式无效')
  }
  for (const [ids, deletedAt] of [[changes.removeIds ?? [], now], [changes.restoreIds ?? [], null]] as const) {
    for (const id of new Set(ids)) {
      const file = records.find(row => row.id === id && row.ownerId === ownerId && row.ownerType === 'receipt_registration')
      if (!file)
        throw receiptProblem('relationship-mismatch', '附件不存在或不属于当前收款记录')
      if (changes.removeIds?.includes(id) && changes.restoreIds?.includes(id))
        throw receiptProblem('validation-failed', '同一附件不能同时删除与恢复')
      file.deletedAt = deletedAt
    }
  }
  for (const input of changes.add ?? []) {
    if (!input || typeof input.fileName !== 'string' || !input.fileName.trim()
      || !Number.isSafeInteger(input.fileSize) || input.fileSize! < 0
      || typeof input.payloadBase64 !== 'string' || input.payloadBase64.length > 20_000_000
      || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(input.payloadBase64)) {
      throw receiptProblem('validation-failed', '附件名称、大小或正文无效，请重新选择文件')
    }
    const bytes = Buffer.from(input.payloadBase64, 'base64')
    if (bytes.toString('base64') !== input.payloadBase64 || bytes.byteLength !== input.fileSize)
      throw receiptProblem('validation-failed', '附件正文与文件大小不符')
    const id = createId()
    if (payloads.has(id) || records.some(file => file.id === id))
      throw receiptProblem('conflict', '附件编号与已有记录冲突，请重新保存')
    records.push({
      id,
      ownerType: 'receipt_registration',
      ownerId,
      fileName: input.fileName.trim(),
      filePath: '',
      fileSize: input.fileSize!,
      mimeType: input.mimeType?.trim() || 'application/octet-stream',
      category: input.category?.trim() || '',
      uploader: actorId,
      uploadedAt: now,
      deletedAt: null,
    })
    payloads.set(id, input.payloadBase64)
    attachmentIds.push(id)
  }
  return { records, payloads, attachmentIds }
}

export function readReceiptAttachment(records: FileRefRecord[], payloads: Map<string, string>, fileId: string): ReceiptFileContent {
  const file = records.find(row => row.id === fileId)
  if (!file || file.deletedAt)
    throw receiptProblem('not-found', '附件不存在或已删除')
  const payloadBase64 = payloads.get(fileId)
  if (payloadBase64 === undefined)
    throw receiptProblem('not-found', '历史附件未保存正文，当前无法读取；请重新上传')
  return { receiptId: file.ownerId, fileId: file.id, dataOrigin: 'real', fileSize: file.fileSize, sha256: createHash('sha256').update(Buffer.from(payloadBase64, 'base64')).digest('hex'), payloadBase64, mimeType: file.mimeType, fileName: file.fileName }
}
