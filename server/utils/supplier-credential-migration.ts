import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { SupplierCredentialMigrationGraph, SupplierCredentialMigrationRow } from '../../app/lib/migration/supplier-credential-source'
import type { SupplierCredentialAggregate } from '../../app/lib/supplier/credential-domain'
import { createHash } from 'node:crypto'
import { parseSupplierCredentialAuditFields, parseSupplierCredentialJson, parseSupplierCredentialMigrationGraph, supplierCredentialMigrationBytes } from '../../app/lib/migration/supplier-credential-source'
import { credentialProblem } from '../../app/lib/supplier/credential-contract'
import { canonicalCredentialCategory, hasManualCredentialReviewProof } from '../../app/lib/supplier/credentials'

function invalid(message: string): never {
  throw credentialProblem('relationship-mismatch', `证照迁移：${message}`)
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
    : entry)
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
function graphFor(entity: CoreMigrationServerEntityDTO, snapshot: CoreMigrationSnapshotDTO): SupplierCredentialMigrationGraph {
  let source: unknown
  try {
    source = JSON.parse(text(entity.attributes.graphJson))
  }
  catch {
    return invalid('完整图 JSON 损坏')
  }
  const graph = parseSupplierCredentialMigrationGraph(source, entity.legacyId)
  const supplier = snapshot.entities.find(row => row.entityType === 'suppliers' && row.id === entity.references.supplierId)
  if (!supplier || supplier.legacyId !== graph.supplier.id || supplier.batchId !== entity.batchId
    || supplier.name !== graph.supplier.name || supplier.deletedAt !== graph.supplier.deleted_at
    || entity.name !== supplier.name || entity.deletedAt !== supplier.deletedAt
    || Object.keys(entity.references).some(key => key !== 'supplierId')) {
    invalid('供应商稳定身份、来源名称、批次或删除边界错配')
  }
  return graph
}

function mappedAggregate(entity: CoreMigrationServerEntityDTO, graph: SupplierCredentialMigrationGraph, fingerprint: string, _now: Date): SupplierCredentialAggregate {
  const supplierId = entity.references.supplierId!
  const mappedId = (part: string, id: unknown) => `credential-migration:${hash(JSON.stringify([entity.id, part, id]))}`
  const nullableId = (part: string, id: unknown) => id === null ? null : mappedId(part, id)
  const payloads = new Map(graph.payloads.map(row => [row.file_ref_id, row]))
  const aggregate: SupplierCredentialAggregate = {
    supplierId,
    version: 1,
    migrationBatchId: entity.batchId,
    migrationSourceHash: fingerprint,
    legacySupplierId: entity.legacyId,
    changedAfterMigration: false,
    commands: [],
    credentials: graph.credentials.map(row => ({
      id: mappedId('credentials', row.id),
      supplierId,
      category: canonicalCredentialCategory(text(row.category)),
      validFrom: text(row.valid_from),
      expiresAt: text(row.expires_at),
      longTerm: row.long_term === 1,
      fileRefId: nullableId('files', row.file_ref_id),
      legacyFilePath: text(row.file_path),
      ocrResult: parseSupplierCredentialJson(row.ocr_result, 'OCR 原文'),
      ocrConfidence: row.ocr_confidence as number | null,
      ocrConfirmedResult: parseSupplierCredentialJson(row.ocr_confirmed_result, 'OCR 已确认结果'),
      ocrConfirmedAt: row.ocr_confirmed_at as string | null,
      ocrReviewStatus: row.ocr_review_status as 'not_started' | 'pending' | 'confirmed',
      verifiedAt: row.verified_at as string | null,
      addedAt: row.added_at as string | null,
      // 原表没有 updated_at，不能用迁移当天伪造发生时间。
      updatedAt: null,
      deletedAt: row.deleted_at as string | null,
      deletionToken: null,
      migrationBatchId: entity.batchId,
      legacyId: text(row.id),
    })),
    files: graph.files.map((row) => {
      const payload = payloads.get(row.id)
      const bytes = payload ? supplierCredentialMigrationBytes(row, payload) : null
      return {
        id: mappedId('files', row.id),
        ownerType: 'supplier_credential' as const,
        ownerId: mappedId('credentials', row.owner_id),
        fileName: text(row.file_name),
        fileSize: Number(row.file_size),
        mimeType: text(row.mime_type),
        payloadBase64: payload ? text(payload.content) : null,
        sha256: bytes ? createHash('sha256').update(bytes).digest('hex') : null,
        createdAt: row.uploaded_at as string | null,
        deletedAt: row.deleted_at as string | null,
        migrationBatchId: entity.batchId,
        legacyId: text(row.id),
      }
    }),
    requirements: graph.requirements.map(row => ({
      id: mappedId('requirements', row.id),
      supplierId,
      category: canonicalCredentialCategory(text(row.category)),
      requirement: row.requirement as 'required' | 'optional' | 'not_applicable',
      reason: text(row.reason),
      updatedAt: row.updated_at as string | null,
      deletedAt: row.deleted_at as string | null,
      migrationBatchId: entity.batchId,
      legacyId: text(row.id),
    })),
    audits: graph.credentialAudits.map(row => ({
      id: mappedId('credentialAudits', row.id),
      credentialId: mappedId('credentials', row.credential_id),
      action: text(row.action),
      categoryBefore: text(row.category_before),
      categoryAfter: text(row.category_after),
      changedFields: parseSupplierCredentialAuditFields(row.changed_fields),
      validFromBefore: text(row.valid_from_before),
      validFromAfter: text(row.valid_from_after),
      expiresAtBefore: text(row.expires_at_before),
      expiresAtAfter: text(row.expires_at_after),
      longTermBefore: row.long_term_before === 1,
      longTermAfter: row.long_term_after === 1,
      confidence: row.confidence as number | null,
      createdAt: text(row.created_at),
      actorId: null,
      deletionToken: null,
      canRestore: false,
    })),
    supplierAudits: graph.supplierAudits.map(row => ({
      id: mappedId('supplierAudits', row.id),
      action: text(row.action),
      outcome: text(row.outcome),
      sourceCategory: text(row.source_category),
      changedFields: parseSupplierCredentialAuditFields(row.changed_fields),
      notePresent: row.note_present === 1,
      createdAt: text(row.created_at),
      actorId: null,
    })),
    review: null,
    ...(graph.reviewHistory
      ? { reviewHistory: graph.reviewHistory.map(row => ({
          decision: row.decision as 'qualified' | 'rejected',
          reviewedAt: text(row.reviewed_at),
          note: text(row.note),
          actorId: row.actor_id as string | null,
          historyIdentity: { id: mappedId('reviewHistory', row.id), legacyId: text(row.id), archivedAt: text(row.archived_at) },
        })) }
      : {}),
  }
  const proof = { status: text(graph.supplier.credential_status), reviewedAt: graph.supplier.credential_reviewed_at as string | null, reviewNote: text(graph.supplier.credential_review_note) }
  if (hasManualCredentialReviewProof(proof)) {
    aggregate.review = { decision: proof.status as 'qualified' | 'rejected', reviewedAt: proof.reviewedAt!, note: proof.reviewNote, actorId: null }
  }
  for (const credential of aggregate.credentials) {
    if (!credential.deletedAt)
      continue
    const original = aggregate.files.find(row => row.id === credential.fileRefId)
    if (original && original.deletedAt !== credential.deletedAt)
      continue
    const history = aggregate.audits.filter(row => row.credentialId === credential.id && ['credential_delete', 'credential_restore'].includes(row.action))
    const matching = history.filter(row => row.action === 'credential_delete' && row.createdAt === credential.deletedAt)
    if (matching.length !== 1 || history.some(row => row.createdAt > credential.deletedAt! || (row.action === 'credential_restore' && row.createdAt === credential.deletedAt)))
      continue
    const audit = matching[0]!
    credential.deletionToken = `credential-deletion:${hash(JSON.stringify([credential.id, audit.id, credential.deletedAt]))}`
    audit.deletionToken = credential.deletionToken
    audit.canRestore = true
  }
  return aggregate
}

/** 完整候选不修改 current；由供应商主档协调器一次发布主档与专用证照事实。 */
export function prepareSupplierCredentialMigration(current: readonly SupplierCredentialAggregate[], snapshot: CoreMigrationSnapshotDTO, now = new Date()): { aggregates: SupplierCredentialAggregate[], changed: boolean } {
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  if (snapshot.authority === 'central' && !batchId)
    invalid('中央迁移缺少活动批次')
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'supplier_credentials') : []
  const ids = new Set<string>()
  const suppliers = new Set<string>()
  const legacySuppliers = new Set<string>()
  const physicalIds = new Set<string>()
  const mapped = entities.map((entity) => {
    if (!entity.id || entity.batchId !== batchId || ids.has(entity.id) || !entity.references.supplierId
      || suppliers.has(entity.references.supplierId) || legacySuppliers.has(entity.legacyId)) {
      invalid('证照批次、供应商或来源身份重复/无效')
    }
    ids.add(entity.id)
    suppliers.add(entity.references.supplierId)
    legacySuppliers.add(entity.legacyId)
    const graph = graphFor(entity, snapshot)
    for (const part of ['credentials', 'requirements', 'files', 'credentialAudits', 'supplierAudits', 'reviewHistory'] as const) {
      for (const row of graph[part] ?? []) {
        const key = JSON.stringify([part, row.id])
        if (physicalIds.has(key))
          invalid('物理旧身份跨分供方重复')
        physicalIds.add(key)
      }
    }
    return mappedAggregate(entity, graph, hash(canonical([entity.id, entity.references.supplierId, graph])), now)
  })
  const bySupplier = new Map(current.map(row => [row.supplierId, row]))
  if (bySupplier.size !== current.length)
    invalid('当前中央分供方证照身份重复')
  const removed = current.filter(row => row.migrationBatchId && (row.migrationBatchId !== batchId || !suppliers.has(row.supplierId)))
  for (const row of removed) {
    if (row.changedAfterMigration || [...row.credentials, ...row.files, ...row.requirements].some(child => child.migrationBatchId !== row.migrationBatchId))
      throw credentialProblem('conflict', '该迁入分供方已有独立证照或日常更正，仍依赖迁入身份；已阻止恢复并保留全部当前事实')
  }
  const aggregates = structuredClone(current.filter(row => !removed.includes(row)))
  let changed = removed.length > 0
  for (const next of mapped) {
    const existing = bySupplier.get(next.supplierId)
    if (existing && !removed.includes(existing)) {
      if (existing.migrationBatchId !== next.migrationBatchId || existing.legacySupplierId !== next.legacySupplierId)
        throw credentialProblem('conflict', '迁入证照与中央独立分供方资料冲突，不能覆盖')
      if (existing.migrationSourceHash !== next.migrationSourceHash)
        throw credentialProblem('conflict', '同批次证照来源内容发生变化，不能覆盖已确认资料')
      continue
    }
    aggregates.push(next)
    changed = true
  }
  return { aggregates, changed }
}

/** 供共享主档投影读取完整来源；保留字段原义，不推断内部码与税号互换。 */
export function migratedSupplierCredentialMaster(snapshot: CoreMigrationSnapshotDTO, supplierId: string): SupplierCredentialMigrationRow | null {
  const entities = snapshot.entities.filter(row => row.entityType === 'supplier_credentials' && row.references.supplierId === supplierId)
  if (entities.length > 1)
    invalid('同一供应商出现多个证照来源')
  return entities[0] ? structuredClone(graphFor(entities[0], snapshot).supplier) : null
}
