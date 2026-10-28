import type { BoqCommand } from '../../app/lib/boq/production-contract'
import { parseOwnerCommercialDocumentCommandRequest } from './owner-commercial-document-command-request'
import { boqFail } from './production-boq-record'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export function boqClosed(value: unknown, keys: readonly string[]) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key)))
    return boqFail('validation-failed', '清单请求包含未定义字段，请保留原输入')
  return value
}
export const boqStableId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,79}$/i.test(value)
const rowFields = ['section', 'trade', 'itemCode', 'itemName', 'unit', 'qty', 'totalQty', 'unitPrice', 'amount', 'building', 'unitType', 'multiplier', 'room', 'floorZone', 'spec', 'taxRate', 'ownerSupplied', 'sourceSheet', 'sourceRow']
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))
function ownerAttachments(value: unknown) {
  const changes = boqClosed(value, ['add', 'removeIds', 'restoreIds'])
  for (const key of ['removeIds', 'restoreIds']) {
    if (changes[key] !== undefined && (!Array.isArray(changes[key]) || !(changes[key] as unknown[]).every(boqStableId) || new Set(changes[key] as string[]).size !== (changes[key] as string[]).length))
      return boqFail('validation-failed', '签证附件操作必须指定不重复的真实原附件ID')
  }
  if ((changes.removeIds as string[] | undefined)?.some(id => (changes.restoreIds as string[] | undefined)?.includes(id)))
    return boqFail('validation-failed', '同一原附件不能同时删除和恢复')
  if (changes.add !== undefined && !Array.isArray(changes.add))
    return boqFail('validation-failed', '签证附件必须是完整原件数组')
  for (const value of (changes.add ?? []) as unknown[]) {
    const file = boqClosed(value, ['fileName', 'filePath', 'fileSize', 'mimeType', 'category', 'uploader', 'payloadBase64'])
    if (typeof file.fileName !== 'string' || !file.fileName.trim() || file.fileName !== file.fileName.trim() || !Number.isSafeInteger(file.fileSize) || Number(file.fileSize) <= 0 || typeof file.payloadBase64 !== 'string' || !file.payloadBase64 || ['mimeType', 'category', 'uploader'].some(key => file[key] !== undefined && typeof file[key] !== 'string') || (file.filePath !== undefined && file.filePath !== ''))
      return boqFail('validation-failed', '新签证附件须提交真实完整正文和大小，历史路径不授予读取能力')
  }
}
function ownerChange(value: Record<string, unknown>) {
  if (!['save', 'submit', 'approve', 'attachments', 'delete'].includes(String(value.action)))
    return boqFail('validation-failed', '施工签证只接受原变洽签的已登记动作')
  const envelope = ['workspaceId', 'actorId', 'commandId', 'requiredCapability', 'kind', 'id', 'baseVersion', 'action']
  boqClosed(value, [...envelope, ...(['save', 'submit'].includes(String(value.action)) ? ['draft', 'attachments'] : value.action === 'attachments' ? ['attachments'] : value.action === 'approve' ? ['approvedAt'] : [])])
  if ((value.id !== null && !boqStableId(value.id)) || (value.baseVersion !== null && (typeof value.baseVersion !== 'string' || !value.baseVersion)) || ((value.id === null) !== (value.baseVersion === null)))
    return boqFail('validation-failed', '签证须保明确原ID及实际版本，新建不能携带旧版本')
  if (['save', 'submit'].includes(String(value.action))) {
    const draft = boqClosed(value.draft, ['id', 'code', 'no', 'name', 'projectId', 'contractId', 'changeType', 'directiveNo', 'directiveType', 'documentType', 'applicationDate', 'reason', 'approvedTaxInclusiveAmount', 'approvedTaxExclusiveAmount', 'appliedTaxExclusiveAmount', 'note', 'lines'])
    if (!boqStableId(draft.projectId) || !boqStableId(draft.contractId) || (draft.id !== undefined && draft.id !== value.id) || !Array.isArray(draft.lines) || Object.entries(draft).some(([key, entry]) => key !== 'lines' && !['approvedTaxInclusiveAmount', 'approvedTaxExclusiveAmount', 'appliedTaxExclusiveAmount'].includes(key) && typeof entry !== 'string') || ['approvedTaxInclusiveAmount', 'approvedTaxExclusiveAmount', 'appliedTaxExclusiveAmount'].some(key => draft[key] !== undefined && !nullableNumber(draft[key])))
      return boqFail('validation-failed', '签证草稿字段与真实项目主合同格式不符')
    for (const raw of draft.lines) {
      const line = boqClosed(raw, ['id', 'operation', 'boqLineId', 'itemId', 'section', 'trade', 'itemName', 'unit', 'qty', 'deltaQty', 'newUnitPrice', 'spec', 'note'])
      if (!['add', 'qty', 'price'].includes(String(line.operation)) || Object.entries(line).some(([key, entry]) => ['qty', 'deltaQty', 'newUnitPrice'].includes(key) ? !nullableNumber(entry) : ['boqLineId', 'itemId'].includes(key) ? entry !== null && (typeof entry !== 'string' || !entry) : typeof entry !== 'string'))
        return boqFail('validation-failed', '签證清单行只能提交明确变更输入，不能伪造原量价或冻结结果')
    }
    ownerAttachments(value.attachments)
  }
  else if (value.action === 'attachments') {
    ownerAttachments(value.attachments)
  }
  parseOwnerCommercialDocumentCommandRequest(value)
}
export function parseProductionBoqCommand(value: unknown): BoqCommand {
  const root = boqClosed(value, ['workspaceId', 'actorId', 'commandId', 'requiredCapability', 'projectId', 'contractId', 'origin', 'contractVersion', 'action'])
  if (!['workspaceId', 'actorId', 'commandId', 'projectId', 'contractId'].every(key => boqStableId(root[key])) || root.requiredCapability !== 'boq:write' || root.origin !== 'real' || typeof root.contractVersion !== 'string' || !root.contractVersion.trim() || !object(root.action))
    return boqFail('validation-failed', '清单原身份、正式范围或实际主合同版本无效')
  const action = root.action
  if (action.kind === 'import-file') {
    boqClosed(action, ['kind', 'original', 'formatClass', 'rows', 'bindings'])
    const original = boqClosed(action.original, ['fileName', 'mimeType', 'fileSize', 'sha256', 'payloadBase64'])
    if (!['fileName', 'mimeType', 'sha256', 'payloadBase64'].every(key => typeof original[key] === 'string' && String(original[key]).trim()) || !/^[a-f0-9]{64}$/.test(String(original.sha256)) || !Number.isSafeInteger(original.fileSize) || Number(original.fileSize) <= 0 || !['A', 'B', 'C', 'D', 'E'].includes(String(action.formatClass)) || !Array.isArray(action.rows) || !action.rows.length || !Array.isArray(action.bindings) || action.bindings.length !== action.rows.length)
      return boqFail('validation-failed', '必须提交真实完整原文件、明确行及分项身份')
    for (const [index, raw] of action.rows.entries()) {
      const row = boqClosed(raw, rowFields)
      const numbers = ['qty', 'unitPrice', 'amount', 'sourceRow']
      if (Object.keys(row).length !== rowFields.length || !numbers.every(key => typeof row[key] === 'number' && Number.isFinite(row[key]) && Number(row[key]) >= 0) || !['totalQty', 'multiplier', 'taxRate'].every(key => row[key] === null || (typeof row[key] === 'number' && Number.isFinite(row[key]) && Number(row[key]) >= 0)) || typeof row.ownerSupplied !== 'boolean' || !rowFields.filter(key => ![...numbers, 'totalQty', 'multiplier', 'taxRate', 'ownerSupplied'].includes(key)).every(key => typeof row[key] === 'string') || !String(row.itemName).trim())
        return boqFail('validation-failed', '原清单行格式、零值或空值无法核对')
      const binding = boqClosed(action.bindings[index], ['rowKey', 'itemId', 'itemVersion'])
      if (binding.rowKey !== String(index) || !(binding.itemId === null || typeof binding.itemId === 'string') || !(binding.itemVersion === null || typeof binding.itemVersion === 'string') || ((binding.itemId === null) !== (binding.itemVersion === null)))
        return boqFail('validation-failed', '每行必须保留明确分项身份及真实版本，不能按名称猜接')
    }
  }
  else if (action.kind === 'correct-building') {
    boqClosed(action, ['kind', 'lineId', 'version', 'buildingId', 'buildingVersion', 'reason', 'originalSourceVersion'])
    if (!['lineId', 'version', 'buildingId', 'buildingVersion', 'reason', 'originalSourceVersion'].every(field => typeof action[field] === 'string' && String(action[field]).trim()))
      return boqFail('validation-failed', '清单更正须指定真实原行、实际楼栋和所消费版本及依据')
  }
  else if (action.kind === 'patch-line') {
    boqClosed(action, ['kind', 'lineId', 'version', 'patch', 'itemVersion'])
    const patch = boqClosed(action.patch, ['itemId', 'section', 'trade', 'itemName', 'unit', 'qty', 'unitPrice', 'building', 'unitType', 'multiplier', 'room', 'floorZone', 'spec', 'taxRate', 'ownerSupplied'])
    if (Object.entries(patch).some(([key, entry]) => ['qty', 'unitPrice', 'multiplier', 'taxRate'].includes(key) ? !nullableNumber(entry) || (entry !== null && Number(entry) < 0) : key === 'ownerSupplied' ? typeof entry !== 'boolean' : key === 'itemId' ? entry !== null && !boqStableId(entry) : typeof entry !== 'string') || (typeof patch.itemId === 'string' ? typeof action.itemVersion !== 'string' || !action.itemVersion : action.itemVersion !== undefined))
      return boqFail('validation-failed', '原清单更正字段类型或明确分项实际版本不符')
    if (typeof action.lineId !== 'string' || !action.lineId || typeof action.version !== 'string' || !action.version)
      return boqFail('validation-failed', '更正须指定原清单行和实际版本')
  }
  else if (action.kind === 'delete-line') {
    boqClosed(action, ['kind', 'lineId', 'version'])
    if (typeof action.lineId !== 'string' || !action.lineId || typeof action.version !== 'string' || !action.version)
      return boqFail('validation-failed', '隐藏须指定原清单行与实际版本')
  }
  else if (action.kind === 'restore-import') {
    boqClosed(action, ['kind', 'importId'])
    if (!boqStableId(action.importId))
      return boqFail('validation-failed', '恢复须指定真实原采用批次')
  }
  else if (action.kind === 'owner-change') {
    boqClosed(action, ['kind', 'command'])
    const command = boqClosed(action.command, ['workspaceId', 'actorId', 'commandId', 'requiredCapability', 'kind', 'id', 'baseVersion', 'action', 'draft', 'attachments', 'approvedAt'])
    if (command.kind !== 'owner_change' || command.workspaceId !== root.workspaceId || command.actorId !== root.actorId || command.commandId !== root.commandId)
      return boqFail('validation-failed', '上游命令只允许同原身份的真实甲方变洽签')
    ownerChange(command)
  }
  else if (action.kind === 'reject-change') {
    boqClosed(action, ['kind', 'changeId', 'version', 'note'])
    if (typeof action.changeId !== 'string' || !action.changeId || typeof action.version !== 'string' || !action.version || typeof action.note !== 'string')
      return boqFail('validation-failed', '退回须指定真实原变洽签与版本')
  }
  else {
    return boqFail('validation-failed', '清单上游动作未登记')
  }
  return structuredClone(root) as unknown as BoqCommand
}
