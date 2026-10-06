import type { DeliveryCentralLine, DeliveryCentralRecord, DeliveryFileContent, DeliveryRevision } from '../../app/lib/delivery-record/contract'
import type { DeliverySourceAsset } from '../../app/lib/delivery-record/source-assets'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { DeliveryState } from './delivery-command-service'
import { deliveryProblem } from '../../app/lib/delivery-record/contract'
import { hasCompleteDeliveryValues } from '../../app/lib/delivery-record/domain'
import { deliveryNaturalKey } from '../../app/lib/delivery/review'
import { readDeliveryAsset } from './delivery-assets'
import { restoreLegacyDeliveryHistory } from './delivery-legacy-history'

const text = (value: unknown) => value == null ? '' : String(value)
function objects(value: unknown): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(text(value) || '[]')
  if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row !== 'object' || Array.isArray(row)))
    throw deliveryProblem('validation-failed', '送货迁移明细或历史格式无效')
  return parsed
}
function nullableNumber(value: unknown): number | null {
  if (value == null)
    return null
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw deliveryProblem('validation-failed', '送货迁移数量或金额无效')
  return value
}
function migratedRecord(entity: CoreMigrationServerEntityDTO, snapshot: CoreMigrationSnapshotDTO): { record: DeliveryCentralRecord, asset: DeliveryFileContent | null, revisions: DeliveryRevision[] } {
  const a = entity.attributes
  if (a.sourceProblem)
    throw deliveryProblem('validation-failed', String(a.sourceProblem))
  const project = snapshot.entities.find(row => row.entityType === 'projects' && row.id === entity.references.projectId)
  const supplier = entity.references.supplierId ? snapshot.entities.find(row => row.entityType === 'suppliers' && row.id === entity.references.supplierId) : null
  if (!project || (entity.references.supplierId && !supplier))
    throw deliveryProblem('relationship-mismatch', '送货迁移的项目或分供方归属无效')
  const source = JSON.parse(text(a.assetJson) || 'null') as DeliverySourceAsset | null
  const asset = source ? readDeliveryAsset({ id: `${entity.batchId}:${source.id}`, uploadBatchId: `${entity.batchId}:${source.uploadBatchId}`, fileName: source.originalFileName, mimeType: source.mimeType, fileSize: source.fileSize, sha256: source.sha256, payloadBase64: source.payloadBase64, createdAt: text(a.createdAt), createdBy: '' }) : null
  const archived = Number(a.archived) === 1
  const allLines = objects(a.allLinesJson)
  const ids = new Set<string>()
  const lines: DeliveryCentralLine[] = allLines.filter(line => !line.deletedAt).map((line, index) => {
    if (!text(line.id) || line.recordId !== entity.legacyId || ids.has(text(line.id)))
      throw deliveryProblem('relationship-mismatch', '送货材料明细身份重复或归属无效')
    ids.add(text(line.id))
    const amountSource = line.amountSource ?? 'manual'
    if (!['ocr', 'manual', 'calculated'].includes(String(amountSource)))
      throw deliveryProblem('validation-failed', '送货材料金额来源无效')
    return { id: `${entity.id}:line:${line.id}`, deliveryRecordId: entity.id, materialName: text(line.materialName), spec: text(line.spec), unit: text(line.unit), qty: nullableNumber(line.qty), unitPrice: nullableNumber(line.unitPrice), amount: nullableNumber(line.amount), amountSource: amountSource as DeliveryCentralLine['amountSource'], note: text(line.note), sortOrder: index, currentValueConfirmed: false }
  })
  const confirmed = archived && a.ocrStatus === 'reviewed' && hasCompleteDeliveryValues({ supplierId: supplier?.id, deliveryDate: a.deliveryDate, lines })
  for (const line of lines)
    line.currentValueConfirmed = confirmed
  const record: DeliveryCentralRecord = {
    id: entity.id,
    dataOrigin: 'real',
    version: '1',
    uploadBatchId: asset?.uploadBatchId ?? `${entity.batchId}:${text(a.printBatchId) || entity.legacyId}`,
    assetId: asset?.id ?? null,
    projectId: project.id,
    supplierId: supplier?.id ?? null,
    projectName: project.name,
    supplierName: supplier?.name ?? '',
    orderNo: text(a.orderNo),
    deliveryDate: text(a.deliveryDate),
    note: text(a.note),
    rawSiteText: text(a.rawSiteText),
    reviewFlag: text(a.reviewFlag),
    lines,
    fileName: asset?.fileName || text(a.fileName),
    filePath: '',
    hasSourceFile: !!asset,
    ocrStatus: text(a.ocrStatus),
    reviewStatus: confirmed ? 'reviewed' : 'unreviewed',
    currentValuesConfirmed: confirmed,
    naturalKeyDuplicate: false,
    archived,
    stored: archived,
    printBatchId: asset?.uploadBatchId ?? `${entity.batchId}:${text(a.printBatchId) || entity.legacyId}`,
    printDisposition: a.printDisposition === 'pending' || a.printDisposition === 'printed' ? a.printDisposition : 'excluded',
    printedAt: text(a.printedAt),
    printExcludedAt: text(a.printExcludedAt),
    totalAmount: Math.round((lines.reduce((sum, line) => sum + (line.amount ?? 0), 0) + Number.EPSILON) * 100) / 100,
    createdAt: text(a.createdAt),
    updatedAt: text(a.updatedAt),
    createdBy: '',
    updatedBy: '',
    deletedAt: entity.deletedAt,
    migrationBatchId: entity.batchId,
    legacyAudit: objects(a.auditJson).length ? text(a.auditJson) : null,
  }
  const restored = restoreLegacyDeliveryHistory(record, entity.legacyId, allLines, objects(a.auditJson), (kind, legacyId) => {
    const identity = snapshot.entities.find(row => row.entityType === kind && row.legacyId === legacyId && row.batchId === entity.batchId)
    return identity ? { id: identity.id, name: identity.name } : null
  })
  record.version = restored.currentVersion
  const revision: DeliveryRevision = { id: `${entity.id}:migration`, recordId: entity.id, version: record.version, action: 'migration', reason: `旧库迁入的当前基线；已恢复 ${restored.revisions.length} 条可核实修改，${restored.unresolvedCount} 条旧审计待核验；未补写未知操作者或原因`, actorId: '', createdAt: record.updatedAt, before: null, after: structuredClone(record), changes: [] }
  return { record, asset, revisions: [...restored.revisions, revision] }
}

export function prepareDeliveryMigration(current: DeliveryState, snapshot: CoreMigrationSnapshotDTO): { state: DeliveryState, changed: boolean } {
  const state = structuredClone(current)
  const imported = snapshot.authority === 'central' ? snapshot.entities.filter(row => row.entityType === 'delivery_records') : []
  const incoming = new Set(imported.map(row => row.id))
  let changed = false
  for (const record of state.records.values()) {
    if (record.migrationBatchId && (record.migrationBatchId !== snapshot.activeBatchId || !incoming.has(record.id))) {
      const baseline = state.revisions.get(record.id)?.find(revision => revision.action === 'migration')
      if (!baseline || baseline.version !== record.version || [...state.commands.values()].some(command => command.result.id === record.id))
        throw deliveryProblem('conflict', '迁入送货记录已有后来修改、打印或原件变更，不能回滚移除')
      state.records.delete(record.id)
      state.legacyOriginals.delete(record.id)
      state.revisions.delete(record.id)
      changed = true
    }
  }
  for (const entity of imported) {
    const existing = state.records.get(entity.id)
    if (existing) {
      if (existing.migrationBatchId !== entity.batchId)
        throw deliveryProblem('conflict', '迁入送货记录与现有中央身份冲突')
      continue
    }
    const mapped = migratedRecord(entity, snapshot)
    const legacyOriginals = objects(entity.attributes.legacyOriginalsJson).flatMap((entry) => {
      if (entry.recordId !== entity.legacyId || !entry.legacyFileRefId)
        throw deliveryProblem('relationship-mismatch', '历史送货原件归属无效')
      if (entry.asset === null)
        return []
      const source = entry.asset as DeliverySourceAsset
      return [readDeliveryAsset({ id: `${entity.batchId}:${source.id}`, uploadBatchId: `${entity.batchId}:${source.uploadBatchId}`, fileName: source.originalFileName, mimeType: source.mimeType, fileSize: source.fileSize, sha256: source.sha256, payloadBase64: source.payloadBase64, createdAt: '', createdBy: '' })]
    })
    // owner 已证明的旧原件单独保全；未证明历史祖先与版本关联前，不加入公开原件读取集合。
    state.legacyOriginals.set(entity.id, legacyOriginals)
    if (mapped.asset) {
      const existingAsset = state.assets.get(mapped.asset.id)
      if (existingAsset && (existingAsset.sha256 !== mapped.asset.sha256 || existingAsset.mimeType !== mapped.asset.mimeType))
        throw deliveryProblem('conflict', '迁入送货批次的不可变原件冲突')
      state.assets.set(mapped.asset.id, mapped.asset)
    }
    state.records.set(mapped.record.id, mapped.record)
    state.revisions.set(mapped.record.id, mapped.revisions)
    changed = true
  }
  const usedAssets = new Set([...state.revisions.values()].flatMap(revisions => revisions.flatMap(revision => revision.after.assetId ? [revision.after.assetId] : [])))
  for (const id of state.assets.keys()) {
    if (!usedAssets.has(id))
      state.assets.delete(id)
  }
  for (const record of state.records.values()) {
    const key = deliveryNaturalKey(record)
    record.naturalKeyDuplicate = !!key && [...state.records.values()].filter(other => !other.deletedAt && deliveryNaturalKey(other) === key).length > 1
  }
  if (changed)
    state.version++
  return { state, changed }
}
