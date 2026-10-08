import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { MigrationRawRow } from './migration-domain-evidence'
import { productionBoqFingerprint as boqDigest, productionBoqFailure as boqFail } from './production-boq-codec'
import { BOQ_NATIVE_TABLES } from './production-boq-migration-source'
import { readProductionConstructionSourceIdentities } from './production-construction-contract-sources'

export interface BoqImportedIdentity { table: string, sourceTable?: string, legacyId: string, id: string, projectId: string, contractId: string }
export interface BoqOriginalProof { id: string, logicalFileId: string, sha256: string | null, fileSize: number | null, mimeType: string, fileName: string, bodyState: 'embedded' | 'metadata-only', originalMetadata: Record<string, unknown> | null }
export interface BoqImportEvidence {
  workspaceId: string
  actorId: string
  commandId: string
  sourceSha256: string
  schemaVersion: number
  rawDomain: Record<string, MigrationRawRow[]> & Record<typeof BOQ_NATIVE_TABLES[number], MigrationRawRow[]>
  sourceSchemas: Record<string, { sql: string, columns: unknown[] }>
  domainEvidenceDigest: string
  heads: Array<{ legacyId: string, id: string, projectId: string, version: string }>
  mappings: BoqImportedIdentity[]
  installed: Record<string, string>
  fileProofs: BoqOriginalProof[]
  metadataOnlyFileIds: string[]
  payloadRefs: Array<{ fileRefId: string, encoding: 'base64', sqliteType: string, sha256: string, byteLength: number, columnSha256: string, columnByteLength: number }>
}
type ReadDb = Pick<TransactionDb, 'select'>
export async function readProductionBoqImportEvidence(tx: ReadDb, actor?: Pick<BusinessSession, 'workspaceId' | 'actorId'>) {
  const [identity] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  if (!identity || (actor && (actor.workspaceId !== identity.workspace_id || actor.actorId !== identity.owner_id)))
    return boqFail('forbidden', '本域原清单来源与真实操作者不同')
  const stored = await tx.select<{ id: string, workspace_id: string, actor_id: string, command_id: string, source_sha256: string, evidence_json: string, evidence_sha256: string }>('SELECT * FROM boq_source_imports ORDER BY id')
  const output = []
  for (const row of stored) {
    let evidence: BoqImportEvidence
    try {
      evidence = JSON.parse(row.evidence_json)
    }
    catch { return boqFail('unavailable', '原本域来源 JSON 不能核对') }
    if (row.workspace_id !== identity.workspace_id || row.actor_id !== identity.owner_id || evidence.workspaceId !== row.workspace_id || evidence.actorId !== row.actor_id || evidence.commandId !== row.command_id || evidence.sourceSha256 !== row.source_sha256 || !/^[a-f0-9]{64}$/.test(row.source_sha256) || boqDigest(evidence) !== row.evidence_sha256 || !Array.isArray(evidence.mappings) || !Array.isArray(evidence.fileProofs) || !Array.isArray(evidence.metadataOnlyFileIds) || !evidence.rawDomain || !evidence.sourceSchemas || Object.keys(evidence.rawDomain).sort().join(',') !== [...BOQ_NATIVE_TABLES].sort().join(',') || Object.keys(evidence.sourceSchemas).sort().join(',') !== [...BOQ_NATIVE_TABLES].sort().join(',') || evidence.domainEvidenceDigest !== boqDigest({ rawDomain: evidence.rawDomain, sourceSchemas: evidence.sourceSchemas }))
      return boqFail('unavailable', '完整本域原SQL类型/未知扩展/日志/映射或来源摘要不一致')
    for (const table of BOQ_NATIVE_TABLES) {
      if (!Array.isArray(evidence.rawDomain[table]) || !evidence.sourceSchemas[table]?.sql || !Array.isArray(evidence.sourceSchemas[table]?.columns))
        return boqFail('unavailable', '本域实际来源表或SQL结构缺失，不允许用空集合替代未读成功的表')
    }
    const parents = await readProductionConstructionSourceIdentities(tx, { ...identity, workspaceId: identity.workspace_id, actorId: identity.owner_id, capabilities: ['construction-contract:read'] }, row.source_sha256, { includeDeleted: true })
    for (const head of evidence.heads) {
      if (!parents.contracts.some(parent => parent.legacyId === head.legacyId && parent.id === head.id && parent.projectId === head.projectId))
        return boqFail('unavailable', '原清单没有同SHA已确认施工主合同归属，不能按名称猜接')
    }
    for (const mapping of evidence.mappings) {
      if (!['boq_files', 'boq_lines', 'item_unit_prices', 'boq_change_records'].includes(mapping.table) || !evidence.heads.some(head => head.id === mapping.contractId && head.projectId === mapping.projectId))
        return boqFail('unavailable', '原清单映射超出实际领域或真实施工主合同')
      const sourceTable = mapping.sourceTable ?? (mapping.table === 'boq_change_records' ? 'boq_change_orders' : mapping.table)
      if (!evidence.rawDomain[sourceTable]?.some(raw => raw.legacyId === mapping.legacyId))
        return boqFail('unavailable', '确认身份没有原完整领域行，不能用同ID字符串补作证据')
      const [current] = await tx.select<{ project_id: string, contract_id: string }>(`SELECT project_id,contract_id FROM ${mapping.table} WHERE id=?`, [mapping.id])
      if (!current || current.project_id !== mapping.projectId || current.contract_id !== mapping.contractId)
        return boqFail('unavailable', '原正式清单身份或父关系不再存在，不能恢复到另一个实体')
    }
    const bindings = await tx.select<{ legacy_id: string, entity_type: string, entity_id: string, project_id: string, contract_id: string, source_sha256: string }>('SELECT * FROM boq_source_bindings WHERE import_id=? ORDER BY entity_type,legacy_id', [row.id])
    if (bindings.length !== evidence.mappings.length || bindings.some(binding => binding.source_sha256 !== row.source_sha256 || !evidence.mappings.some(mapping => binding.legacy_id === mapping.legacyId && binding.entity_type === (mapping.sourceTable ?? mapping.table) && binding.entity_id === mapping.id && binding.project_id === mapping.projectId && binding.contract_id === mapping.contractId)))
      return boqFail('unavailable', '原来源索引与已确认整批映射不能互证')
    if (evidence.metadataOnlyFileIds.length !== evidence.fileProofs.filter(file => file.bodyState === 'metadata-only').length || evidence.metadataOnlyFileIds.some(id => !evidence.fileProofs.some(file => file.id === id && file.bodyState === 'metadata-only' && file.sha256 === null)))
      return boqFail('unavailable', '历史缺件只能沿原缺件图，不能把任意原件改成无正文')
    output.push({ importId: row.id, evidence })
  }
  return output
}
/** Confirmed SHA evidence only. A matching literal ID without this record never qualifies as an adopted upstream. */
export async function readProductionBoqImportedIdentities(tx: ReadDb, sourceSha256: string, actor?: Pick<BusinessSession, 'workspaceId' | 'actorId'>): Promise<BoqImportedIdentity[]> {
  const record = (await readProductionBoqImportEvidence(tx, actor)).find(row => row.evidence.sourceSha256 === sourceSha256)
  if (!record || (await tx.select('SELECT import_id FROM boq_import_restores WHERE import_id=?', [record.importId])).length)
    return boqFail('unavailable', '该完整来源没有已确认且仍有效的施工清单映射，不能按原ID猜新采用资格')
  return structuredClone(record.evidence.mappings)
}
