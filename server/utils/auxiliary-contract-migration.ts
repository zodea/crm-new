import type { AuxiliaryContractFact } from '../../app/lib/auxiliary-contract/contract'
import type { ContractFormAttachment } from '../../app/lib/contract/forms'
import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { AuxiliaryStoredContract } from './auxiliary-contract-test-instance'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { decodeAuxiliaryDraft } from '../../app/lib/auxiliary-contract/validation'
import { isCoreMigrationMoney } from '../../app/lib/migration/core-contract'

export function migratedAuxiliaryContract(entity: CoreMigrationServerEntityDTO, batchId: string): AuxiliaryStoredContract {
  const a = entity.attributes
  const text = (key: string) => a[key] == null ? null : String(a[key])
  const draft = decodeAuxiliaryDraft({
    id: entity.id,
    kind: a.kind,
    name: entity.name,
    no: text('no'),
    category: text('category'),
    projectId: entity.references.projectId ?? null,
    supplierId: entity.references.supplierId ?? null,
    counterparty: text('counterparty'),
    partyA: text('partyA'),
    signDate: text('signDate'),
    servicePeriod: text('servicePeriod'),
    amount: entity.amount === null ? null : Number(entity.amount),
    taxRate: a.taxRate ?? null,
    invoiceType: text('invoiceType'),
    paymentCycle: text('paymentCycle'),
    mainTerms: text('mainTerms'),
    status: text('status') || '草稿',
    note: text('note'),
  })
  function array(key: string): Array<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse(text(key) || '[]')
      if (!Array.isArray(value) || !value.every(row => row && typeof row === 'object' && !Array.isArray(row)))
        throw new Error('迁移集合格式错误')
      return value
    }
    catch {
      throw auxiliaryProblem('validation-failed', '迁移附件或票款事实格式无效')
    }
  }
  const attachmentIds = new Set<string>()
  const attachments = array('filesJson').map((file): ContractFormAttachment => {
    if (typeof file.id !== 'string' || !file.id || attachmentIds.has(file.id) || typeof file.fileName !== 'string' || !file.fileName
      || typeof file.fileSize !== 'number' || !Number.isSafeInteger(file.fileSize) || file.fileSize < 0) {
      throw auxiliaryProblem('validation-failed', '迁移附件缺少稳定身份或有效元数据')
    }
    attachmentIds.add(file.id)
    return { id: file.id, ownerId: entity.id, ownerType: draft.kind === 'company_expense' ? 'company_expense_contract' : 'contract', fileName: file.fileName, filePath: '', fileSize: file.fileSize, mimeType: String(file.mimeType ?? ''), category: String(file.category ?? ''), uploader: String(file.uploader ?? ''), uploadedAt: String(file.uploadedAt ?? ''), deletedAt: file.deletedAt == null ? null : String(file.deletedAt) }
  })
  const factIds = new Set<string>()
  const facts = array('factsJson').map((fact): AuxiliaryContractFact => {
    const kind = fact.kind as AuxiliaryContractFact['kind']
    if (!['invoice', 'payment', 'settlement', 'supplement'].includes(kind) || typeof fact.id !== 'string' || !fact.id || factIds.has(`${kind}:${fact.id}`)
      || (fact.amount !== null && !isCoreMigrationMoney(fact.amount)) || ![true, false, 0, 1].includes(fact.effective as boolean | number)
      || (draft.kind === 'company_expense' && (kind === 'settlement' || kind === 'supplement'))) {
      throw auxiliaryProblem('validation-failed', '迁移票款事实身份、类别或金额无效')
    }
    factIds.add(`${kind}:${fact.id}`)
    return { id: fact.id, kind, contractId: entity.id, contractKind: draft.kind, dataOrigin: 'real', no: String(fact.no ?? ''), name: String(fact.name ?? ''), amount: fact.amount as string | null, date: fact.date == null ? null : String(fact.date), status: String(fact.status ?? ''), effective: Boolean(fact.effective) }
  })
  return { draft: { ...draft, id: entity.id }, attachments, facts, version: 1, workspaceId: 'workspace-default', migrationBatchId: batchId, settlementStatus: text('settlementStatus'), clearanceStatus: text('clearanceStatus'), audit: { createdBy: text('createdBy'), updatedBy: text('updatedBy'), createdAt: text('createdAt'), updatedAt: text('updatedAt'), responsible: text('responsible'), department: text('department') } }
}
