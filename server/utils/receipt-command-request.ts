import type { ReceiptCommand, ReceiptDraft } from '../../app/lib/receipt/contract'
import { emptyReceiptDraft, receiptProblem } from '../../app/lib/receipt/contract'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseReceiptCommand(value: unknown): ReceiptCommand {
  if (!object(value) || !object(value.draft) || !object(value.attachments)
    || !['workspaceId', 'actorId', 'commandId'].every(key => typeof value[key] === 'string' && String(value[key]).trim())
    || value.requiredCapability !== 'receipt:write' || value.origin !== 'real'
    || !['draft', 'save', 'submit'].includes(String(value.action))
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !(value.id === undefined || (typeof value.id === 'string' && value.id.trim()))) {
    throw receiptProblem('validation-failed', '收款命令格式无效')
  }
  const draft = emptyReceiptDraft()
  for (const key of Object.keys(draft) as (keyof ReceiptDraft)[]) {
    const field = value.draft[key]
    if (['amount', 'projectId', 'customerId', 'contractId'].includes(key) ? field !== null && typeof field !== 'string' : typeof field !== 'string')
      throw receiptProblem('validation-failed', '收款字段格式无效', { [key]: ['请重新核对该字段'] })
    Object.assign(draft, { [key]: field })
  }
  for (const key of ['add', 'removeIds', 'restoreIds'] as const) {
    const rows = value.attachments[key]
    if (rows === undefined)
      continue
    if (!Array.isArray(rows) || (key !== 'add' && !rows.every(row => typeof row === 'string' && row)))
      throw receiptProblem('validation-failed', '附件变更格式无效')
    if (key === 'add' && !rows.every(row => object(row)
      && ['fileName', 'filePath', 'mimeType', 'category', 'uploader', 'payloadBase64'].every(field => row[field] === undefined || typeof row[field] === 'string'))) {
      throw receiptProblem('validation-failed', '附件变更字段格式无效')
    }
  }
  return { ...value, draft } as unknown as ReceiptCommand
}
