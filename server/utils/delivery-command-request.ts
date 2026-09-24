import type { DeliveryCommand, DeliveryDraft, DeliveryDraftLine, DeliverySourceUpload } from '../../app/lib/delivery-record/contract'
import { deliveryProblem } from '../../app/lib/delivery-record/contract'

function invalid(): never {
  throw deliveryProblem('validation-failed', '送货命令或字段格式无效，请重新核对')
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, required = false): string {
  if (typeof value !== 'string' || (required && !value.trim()))
    invalid()
  return value
}
function nullableNumber(value: unknown): number | null {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value)))
    invalid()
  return value
}
function line(value: unknown): DeliveryDraftLine {
  const row = object(value, ['id', 'materialName', 'spec', 'unit', 'qty', 'unitPrice', 'amount', 'amountSource', 'note'])
  const result: DeliveryDraftLine = { materialName: text(row.materialName), spec: text(row.spec), unit: text(row.unit), qty: nullableNumber(row.qty), unitPrice: nullableNumber(row.unitPrice), note: text(row.note) }
  if (row.id !== undefined)
    result.id = text(row.id, true)
  if (row.amount !== undefined)
    result.amount = nullableNumber(row.amount)
  if (row.amountSource !== undefined) {
    if (row.amountSource !== 'manual' && row.amountSource !== 'ocr' && row.amountSource !== 'calculated')
      invalid()
    result.amountSource = row.amountSource
  }
  return result
}
function draft(value: unknown): DeliveryDraft {
  const row = object(value, ['projectId', 'supplierId', 'orderNo', 'deliveryDate', 'note', 'rawSiteText', 'reviewFlag', 'confirmations', 'lines'])
  const confirmations = object(row.confirmations, ['noOrderNoConfirmed', 'pricePendingConfirmed', 'amountReviewed'])
  if (Object.values(confirmations).some(flag => typeof flag !== 'boolean') || !Array.isArray(row.lines))
    invalid()
  return {
    projectId: text(row.projectId),
    supplierId: row.supplierId === null ? null : text(row.supplierId),
    orderNo: text(row.orderNo),
    deliveryDate: text(row.deliveryDate),
    note: text(row.note),
    rawSiteText: text(row.rawSiteText),
    reviewFlag: text(row.reviewFlag),
    confirmations: { ...confirmations },
    lines: row.lines.map(line),
  }
}
function source(value: unknown): DeliverySourceUpload {
  const row = object(value, ['fileName', 'mimeType', 'fileSize', 'payloadBase64'])
  if (typeof row.fileSize !== 'number' || !Number.isSafeInteger(row.fileSize) || row.fileSize <= 0)
    invalid()
  return { fileName: text(row.fileName, true), mimeType: text(row.mimeType, true), fileSize: row.fileSize, payloadBase64: text(row.payloadBase64, true) }
}

const ENVELOPE = ['action', 'commandId', 'workspaceId', 'actorId', 'requiredCapability', 'origin']
/** HTTP 只接收本动作的可编辑字段；身份、原件摘要和修订留痕由服务端生成。 */
export function parseDeliveryCommand(value: unknown): DeliveryCommand {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid()
  const input = value as Record<string, unknown>
  if (input.origin !== 'real' || input.requiredCapability !== 'delivery:write')
    invalid()
  const envelope = { commandId: text(input.commandId, true), workspaceId: text(input.workspaceId, true), actorId: text(input.actorId, true), requiredCapability: 'delivery:write' as const, origin: 'real' as const }
  if (input.action === 'archive') {
    const row = object(input, [...ENVELOPE, 'baseVersion', 'uploadBatchId', 'source', 'draft'])
    if (row.baseVersion !== null)
      invalid()
    return { ...envelope, action: 'archive', baseVersion: null, uploadBatchId: row.uploadBatchId === null ? null : text(row.uploadBatchId, true), source: row.source === null ? null : source(row.source), draft: draft(row.draft) }
  }
  if (input.action === 'print') {
    const row = object(input, [...ENVELOPE, 'targets', 'disposition'])
    if (!Array.isArray(row.targets) || !row.targets.length || (row.disposition !== 'printed' && row.disposition !== 'excluded'))
      invalid()
    const targets = row.targets.map((entry) => {
      const target = object(entry, ['id', 'baseVersion'])
      return { id: text(target.id, true), baseVersion: text(target.baseVersion, true) }
    })
    return { ...envelope, action: 'print', targets, disposition: row.disposition }
  }
  const existing = { ...envelope, id: text(input.id, true), baseVersion: text(input.baseVersion, true), reason: text(input.reason, true) }
  const fields = [...ENVELOPE, 'id', 'baseVersion', 'reason']
  if (input.action === 'revise') {
    const row = object(input, [...fields, 'draft'])
    return { ...existing, action: 'revise', draft: draft(row.draft) }
  }
  if (input.action === 'source') {
    const row = object(input, [...fields, 'source'])
    return { ...existing, action: 'source', source: source(row.source) }
  }
  if (input.action === 'undo') {
    const row = object(input, [...fields, 'revisionId'])
    return { ...existing, action: 'undo', revisionId: text(row.revisionId, true) }
  }
  if (input.action === 'delete' || input.action === 'restore') {
    object(input, fields)
    return { ...existing, action: input.action }
  }
  return invalid()
}
