import type { AuxiliaryContractKind } from '../../app/lib/auxiliary-contract/contract'
import type { ContractFormAttachment, ContractFormAttachmentChanges } from '../../app/lib/contract/forms'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'

export function applyAuxiliaryAttachments(current: ContractFormAttachment[], changes: ContractFormAttachmentChanges, context: { id: string, kind: AuxiliaryContractKind, actorId: string, timestamp: string }): ContractFormAttachment[] {
  const removeIds = changes.removeIds ?? []
  const restoreIds = changes.restoreIds ?? []
  const add = changes.add ?? []
  if (!Array.isArray(removeIds) || !Array.isArray(restoreIds) || !Array.isArray(add) || add.length > 30)
    throw auxiliaryProblem('validation-failed', '附件变更格式无效')
  if ([...removeIds, ...restoreIds].some(id => !current.some(file => file.id === id)) || removeIds.some(id => restoreIds.includes(id)))
    throw auxiliaryProblem('validation-failed', '附件不属于当前合同或变更冲突')
  const files = current.map(file => ({ ...file, deletedAt: removeIds.includes(file.id) ? context.timestamp : restoreIds.includes(file.id) ? null : file.deletedAt }))
  for (const file of add) {
    if (!file || typeof file.fileName !== 'string' || !file.fileName.trim() || file.fileName.length > 500
      || (file.fileSize !== undefined && (!Number.isSafeInteger(file.fileSize) || file.fileSize < 0))
      || (file.category !== undefined && typeof file.category !== 'string')
      || (file.mimeType !== undefined && typeof file.mimeType !== 'string')
      || file.filePath) {
      throw auxiliaryProblem('validation-failed', '附件元数据无效；浏览器合同不保存本机路径')
    }
    files.push({ id: crypto.randomUUID(), ownerId: context.id, ownerType: context.kind === 'company_expense' ? 'company_expense_contract' : 'contract', fileName: file.fileName.trim(), fileSize: file.fileSize ?? 0, mimeType: file.mimeType ?? '', category: file.category ?? '合同附件', filePath: '', uploader: context.actorId, uploadedAt: context.timestamp, deletedAt: null })
  }
  return files
}
