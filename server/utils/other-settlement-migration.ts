import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { OtherSettlementFact } from '../../app/lib/other-settlement/contract'
import type { OtherSettlementStored } from './other-settlement-instance'
import { auxiliaryProblem } from '../../app/lib/auxiliary-contract/contract'
import { isCoreMigrationMoney } from '../../app/lib/migration/core-contract'
import { OTHER_SETTLEMENT_STATUS_LABELS } from '../../app/lib/other-settlement/contract'
import { decodeOtherSettlementDraft } from '../../app/lib/other-settlement/validation'

export function migratedOtherSettlement(entity: CoreMigrationServerEntityDTO, batchId: string, entities: CoreMigrationServerEntityDTO[]): OtherSettlementStored {
  const a = entity.attributes
  const text = (key: string) => a[key] == null ? null : String(a[key])
  const contract = entities.find(row => row.entityType === 'auxiliary_contracts' && row.id === entity.references.contractId && !row.deletedAt)
  if (entity.references.contractId && (!contract || contract.attributes.kind !== 'other_expense' || ['草稿', 'draft'].includes(String(contract.attributes.status)) || contract.references.projectId !== entity.references.projectId || contract.references.supplierId !== entity.references.supplierId))
    throw auxiliaryProblem('relationship-mismatch', '迁移结算源合同类型、状态或项目/分供方不匹配')
  const statuses: Record<string, string> = Object.fromEntries(Object.entries(OTHER_SETTLEMENT_STATUS_LABELS).flatMap(([key, label]) => [[key, key], [label, key]]))
  const status = statuses[text('status') ?? '草稿']
  if (!status)
    throw auxiliaryProblem('validation-failed', '迁移结算状态无效')
  function array(key: string): Array<Record<string, unknown>> {
    try {
      const value: unknown = JSON.parse(text(key) || '[]')
      if (!Array.isArray(value) || !value.every(row => row && typeof row === 'object' && !Array.isArray(row)))
        throw new Error('invalid')
      return value
    }
    catch {
      throw auxiliaryProblem('validation-failed', '迁移结算附件或事实集合无效')
    }
  }
  const ids = new Set<string>()
  const facts = array('factsJson').map((f): OtherSettlementFact => {
    if (typeof f.id !== 'string' || !f.id || ids.has(`${f.kind}:${f.id}`) || typeof f.sourceId !== 'string' || !f.sourceId || !['penalty', 'application', 'payment'].includes(String(f.kind)) || !['exact', 'unknown'].includes(String(f.attribution)) || !(f.amount === null || isCoreMigrationMoney(f.amount)) || ![true, false, 0, 1].includes(f.effective as boolean))
      throw auxiliaryProblem('validation-failed', '迁移关联事实身份、金额或状态无效')
    ids.add(`${f.kind}:${f.id}`)
    if (f.projectId !== a.sourceProjectId || f.contractId !== a.sourceContractId || f.supplierId !== a.sourceSupplierId)
      throw auxiliaryProblem('relationship-mismatch', '结算关联事实与源合同关系错配')
    const source = entities.find(row => f.kind === 'penalty'
      ? row.entityType === 'owner_documents' && row.attributes.kind === 'project_penalty' && row.legacyId === f.sourceId
      : row.entityType === 'other_settlement_sources' && row.legacyId === `${f.kind}:${f.sourceId}`)
    const parent = f.parentId == null ? null : entities.find(row => row.entityType === 'other_settlement_sources' && row.legacyId === `application:${f.parentId}`)
    if (!source || (f.parentId != null && !parent))
      throw auxiliaryProblem('relationship-mismatch', '迁移结算缺少真实源单中央身份')
    return { id: `${entity.id}:${f.kind}:${f.id}`, allocationId: f.id, sourceId: source.id, parentId: parent?.id ?? null, kind: f.kind as OtherSettlementFact['kind'], settlementId: entity.id, projectId: entity.references.projectId ?? null, contractId: entity.references.contractId ?? null, supplierId: entity.references.supplierId ?? null, no: String(f.no ?? ''), name: String(f.name ?? ''), amount: f.amount as string | null, date: f.date == null ? null : String(f.date), status: String(f.status ?? ''), effective: Boolean(f.effective), attribution: f.attribution as OtherSettlementFact['attribution'] }
  })
  const attachments = array('filesJson').map((f) => {
    if (typeof f.id !== 'string' || !f.id || ids.has(`file:${f.id}`) || typeof f.fileName !== 'string' || !Number.isSafeInteger(f.fileSize) || Number(f.fileSize) < 0)
      throw auxiliaryProblem('validation-failed', '迁移结算附件元数据无效')
    ids.add(`file:${f.id}`)
    return { id: f.id, ownerId: entity.id, ownerType: 'expenditure_settlement' as const, fileName: f.fileName, fileSize: Number(f.fileSize), filePath: '', mimeType: String(f.mimeType ?? ''), category: String(f.category ?? ''), uploader: String(f.uploader ?? ''), uploadedAt: String(f.uploadedAt ?? ''), deletedAt: f.deletedAt == null ? null : String(f.deletedAt) }
  })
  const draft = decodeOtherSettlementDraft({ id: entity.id, name: entity.name, no: text('no'), projectId: entity.references.projectId, contractId: entity.references.contractId, supplierId: entity.references.supplierId, totalAmount: entity.amount == null ? null : Number(entity.amount), taxRate: a.taxRate ?? null, settlementDate: text('settlementDate'), settlementType: text('settlementType'), period: text('period'), deductionNote: text('deductionNote'), note: text('note'), status })
  return { id: entity.id, version: 1, workspaceId: 'workspace-default', migrationBatchId: batchId, draft, facts, attachments, audit: { createdBy: text('createdBy'), updatedBy: text('updatedBy'), createdAt: text('createdAt'), updatedAt: text('updatedAt'), responsible: text('responsible'), department: text('department') } }
}
