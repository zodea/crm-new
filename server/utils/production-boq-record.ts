import type { BoqCommand, ProductionBoqChangeDocument, ProductionBoqFile, ProductionBoqLine, ProductionBoqPrice } from '../../app/lib/boq/production-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { OwnerCommercialDocumentSource } from '../../app/lib/owner-document/central-repository'
import type { BusinessSession } from './business-session'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createOwnerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { productionBoqFingerprint as boqDigest, productionBoqFailure as boqFail } from './production-boq-codec'
import { readProductionConstructionContractFacts, readProductionConstructionContractReference } from './production-construction-contract-sources'

export { productionBoqFingerprint as boqDigest, productionBoqFailure as boqFail } from './production-boq-codec'
export type BoqLineRecord = Omit<ProductionBoqLine, 'contractName' | 'contractNo' | 'approvedDeltaQty' | 'effectiveUnitPrice' | 'version'> & { createdAt: string, updatedAt: string, deletedAt: string | null }
export type BoqFileRecord = Omit<ProductionBoqFile, 'version'> & { mimeType: string, createdAt: string, updatedAt: string }
export type BoqPriceRecord = Omit<ProductionBoqPrice, 'version'> & { createdAt: string, updatedAt: string, deletedAt: string | null }
export interface BoqStoredRow { id: string, project_id: string, contract_id: string, record_json: string, deleted_at: string | null }

/** Known command bodies have a single shared BLOB; the immutable intent retains its digest and locator. */
export function productionBoqRequestSummary(command: BoqCommand, fileRefId?: string, attachmentRefs?: readonly string[]) {
  if (command.action.kind === 'import-file') {
    const { payloadBase64: _body, ...original } = command.action.original
    return { ...command, action: { ...command.action, original: { ...original, ...(fileRefId ? { fileRefId } : {}) } } }
  }
  if (command.action.kind === 'owner-change' && 'attachments' in command.action.command) {
    const inner = command.action.command
    return { ...command, action: { ...command.action, command: { ...inner, attachments: { ...inner.attachments, ...(inner.attachments.add
      ? { add: inner.attachments.add.map((file, index) => {
          const { payloadBase64, ...metadata } = file
          return { ...metadata, sha256: createHash('sha256').update(Buffer.from(payloadBase64!, 'base64')).digest('hex'), ...(attachmentRefs ? { fileRefId: attachmentRefs[index] } : {}) }
        }) }
      : {}) } } } }
  }
  return command
}
export const productionBoqAttachmentId = (command: Pick<BoqCommand, 'workspaceId' | 'actorId' | 'commandId'>, index: number) => `boq-attachment-${boqDigest([command.workspaceId, command.actorId, command.commandId, index]).slice(0, 24)}`

export async function assertProductionBoq(tx: Pick<TransactionDb, 'select'>, actor: Pick<BusinessSession, 'workspaceId' | 'actorId'>) {
  const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  const [domain] = await tx.select<{ schema_version: number }>('SELECT schema_version FROM production_participants WHERE domain=\'boq\'')
  if (!identity || identity.workspace_id !== actor.workspaceId || identity.owner_id !== actor.actorId)
    return boqFail('forbidden', '清单上游不属于当前真实工作区与操作者')
  if (domain?.schema_version !== 1)
    return boqFail('unavailable', '正式清单 owner 尚未完成已登记连续升级，不能借开发来源替代')
}
export async function readProductionBoqRows<T extends { id: string, projectId: string, contractId: string }>(tx: Pick<TransactionDb, 'select'>, table: 'boq_files' | 'boq_lines' | 'item_unit_prices', projectId?: string, contractId?: string, includeDeleted = false) {
  const conditions = [includeDeleted ? '1=1' : 'deleted_at IS NULL', ...(projectId ? ['project_id=?'] : []), ...(contractId ? ['contract_id=?'] : [])]
  const rows = await tx.select<BoqStoredRow>(`SELECT * FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY id`, [...(projectId ? [projectId] : []), ...(contractId ? [contractId] : [])])
  return rows.map((row) => {
    let value: T
    try {
      value = JSON.parse(row.record_json)
    }
    catch { return boqFail('unavailable', '原清单 JSON 不能核对，请保留持久证据') }
    if (value.id !== row.id || value.projectId !== row.project_id || value.contractId !== row.contract_id || (Object.hasOwn(value, 'deletedAt') && (value as { deletedAt?: string | null }).deletedAt !== row.deleted_at))
      return boqFail('unavailable', '清单身份与真实父归属不一致')
    return { value, version: boqDigest(value), deletedAt: row.deleted_at }
  })
}
export async function readProductionBoqChanges(tx: Pick<TransactionDb, 'select'>, projectId?: string, contractId?: string, includeDeleted = false) {
  const where = [includeDeleted ? '1=1' : 'deleted_at IS NULL', ...(projectId ? ['project_id=?'] : []), ...(contractId ? ['contract_id=?'] : [])]
  const rows = await tx.select<BoqStoredRow>(`SELECT * FROM boq_change_records WHERE ${where.join(' AND ')} ORDER BY id`, [...(projectId ? [projectId] : []), ...(contractId ? [contractId] : [])])
  return rows.map((row) => {
    const value = JSON.parse(row.record_json) as ProductionBoqChangeDocument
    if (value.id !== row.id || value.projectId !== row.project_id || value.contractId !== row.contract_id || value.kind !== 'owner_change' || value.dataOrigin !== 'real')
      return boqFail('unavailable', '原有效变洽签身份或归属不一致')
    return value
  })
}

/** The original owner-change rules run on this transaction's facts, never on its development singleton. */
export async function productionBoqOwnerInTransaction(tx: Pick<TransactionDb, 'select'>, actor: BusinessSession, projectId: string, daily?: { createAttachmentId?: () => string }) {
  await assertProductionBoq(tx, actor)
  const [{ contracts }, lines, documents, projects, customers] = await Promise.all([
    readProductionConstructionContractFacts(tx, actor, { projectId }),
    readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', projectId),
    readProductionBoqChanges(tx, projectId),
    tx.select<{ id: string, name: string, customerId: string | null }>('SELECT id,name,customer_id AS customerId FROM projects WHERE id=? AND deleted_at IS NULL', [projectId]),
    tx.select<{ id: string, name: string }>('SELECT id,name FROM customers WHERE deleted_at IS NULL'),
  ])
  const eligible = contracts.filter(row => !['draft', '草稿'].includes(row.status))
  const quantityDocuments = documents.filter(row => row.sourceType === 'boq_change_order' || (daily && row.sourceType === 'manual')).map((row): OwnerCommercialDocumentSource => {
    const amount = row.boqAmount ?? row.amount
    if (amount === null)
      return boqFail('unavailable', '原变化的工程量金额未知，不能用税额或零回填数量计算')
    return { ...row, amount }
  })
  return createOwnerCommercialDocumentCommandTestInstance({ ...daily, projects, customers, confirmExistingBuildingIdentity: (lineId, buildingId) => lines.find(row => row.value.id === lineId)?.value.declaredBuildingId !== buildingId, contracts: eligible.map(row => ({ id: row.id, no: row.no, name: row.name, projectId: row.projectId!, customerId: row.customerId, amount: row.amount })), boqLines: lines.map(({ value }) => ({ id: value.id, projectId: value.projectId, contractId: value.contractId, itemName: value.itemName, unit: value.unit, qty: value.qty, unitPrice: value.unitPrice, building: value.building, unitType: value.unitType ?? null, floorZone: value.floorZone ?? null, updatedAt: value.updatedAt, autoQty: 0, missingQtyCount: 0, source: { boqFileId: value.fileId, changeOrderId: value.changeId, traceKey: value.traceKey, sourceSheet: value.sourceSheet, sourceRow: value.sourceRow, confirmed: value.confirmedOriginal } })), documents: quantityDocuments })
}

/** Consumers receive one stable owner fact set; E prices never enter the quantity or wage price track. */
export async function readProductionBoqQuantityFacts(tx: Pick<TransactionDb, 'select'>, projectId: string, actor: BusinessSession, consumed?: { lineIds?: readonly string[], contractIds?: readonly string[] }) {
  if (!['boq:read', 'construction-contract:read', 'owner-document:read'].every(capability => actor.capabilities.includes(capability)))
    return boqFail('forbidden', '当前身份不能读取施工合同清单及有效变洽签')
  const owner = await productionBoqOwnerInTransaction(tx, actor, projectId)
  const source = owner.quantityBoqFacts(projectId)
  const selected = source.lines.filter(line => (!consumed?.lineIds || consumed.lineIds.includes(line.id)) && (!consumed?.contractIds || consumed.contractIds.includes(line.contractId)))
  const lines = await readProductionBoqRows<BoqLineRecord>(tx, 'boq_lines', projectId)
  const files = await readProductionBoqRows<BoqFileRecord>(tx, 'boq_files', projectId, undefined, true)
  const changes = await readProductionBoqChanges(tx, projectId)
  const contractIds = [...new Set(selected.map(line => line.contractId))].sort()
  const qualifications = await Promise.all(contractIds.map(async (id) => {
    const reference = await readProductionConstructionContractReference(tx, actor, id)
    return { id, projectId: reference.projectId, status: reference.status, deletedAt: reference.deletedAt, projectDeletedAt: reference.projectDeletedAt }
  }))
  return { projectId, lines: selected.map((line) => {
    const original = lines.find(row => row.value.id === line.id)?.value
    const qualification = qualifications.find(head => head.id === line.contractId)
    const file = files.find(row => row.value.id === original?.fileId)
    const change = changes.find(row => row.id === original?.changeId)
    const sourceQualification = original ? { fileId: original.fileId, changeId: original.changeId, confirmedOriginal: original.confirmedOriginal, deletedAt: original.deletedAt, file: file ? { id: file.value.id, contractId: file.value.contractId, projectId: file.value.projectId, formatClass: file.value.formatClass, deletedAt: file.deletedAt } : null, change: change ? { id: change.id, projectId: change.projectId, contractId: change.contractId, status: change.status, sourceLocked: change.sourceLocked } : null } : null
    const eligible = !!original && (original.fileId ? original.confirmedOriginal && !!file && !file.deletedAt && file.value.formatClass !== 'E' : !!change && change.status === 'approved' && change.sourceLocked)
    const qualified = { id: line.id, projectId, contractId: line.contractId, sourceQualification, qualification, eligible }
    return { ...line, ...(original?.declaredBuildingId ? { declaredBuildingId: original.declaredBuildingId } : {}), eligible, qualificationVersion: boqDigest(qualified), bindingVersion: boqDigest({ ...qualified, qty: line.qty }), version: boqDigest({ line, original, qualification }) }
  }), sourceVersion: `boq-owner:${boqDigest([projectId, selected, qualifications])}` }
}
export const productionBoqContractReference = readProductionConstructionContractReference
export const productionBoqHeadVersion = (head: Awaited<ReturnType<typeof readProductionConstructionContractReference>>) => `boq-head:${boqDigest({ id: head.id, projectId: head.projectId, customerId: head.customerId, status: head.status, deletedAt: head.deletedAt, projectDeletedAt: head.projectDeletedAt })}`
