import type { CrewWorkerImportCommand, CrewWorkerImportPreview, CrewWorkerImportReferenceMapping, CrewWorkerImportResolution, CrewWorkerImportResult } from '../../app/lib/crew-worker/import-contract'
import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { CrewWorkerSourceGraph } from './production-crew-worker-import-source'
import type { ProductionStorage } from './production-storage'
import { isDeepStrictEqual } from 'node:util'
import { CREW_WORKER_IMPORT_SCHEMA_RANGE } from '../../app/lib/crew-worker/import-contract'
import { parseResolveCommandBody } from './command-journal'
import { withVerifiedMigrationSnapshot } from './migration-snapshot'
import { crewWorkerAdoptedRecords, crewWorkerSourceTimestamp, importedSourceAssetId, mappedCrewWorkerArchive, readCrewWorkerSourceGraph } from './production-crew-worker-import-source'
import { productionCrewWorkerFailure as fail, loadProductionCrewWorkers } from './production-crew-worker-record'
import { validateProductionCrewWorkerJournal } from './production-crew-worker-validation'
import { listMigrationReferences, readMigrationReference } from './production-migration-references'
import { rosterHash } from './worker-roster-storage'

type Session = () => BusinessSession
interface SourceEvidence { sourceSha256: string, schemaVersion: number, referenceMappings: Array<CrewWorkerImportReferenceMapping & { sourceVersion: string }>, actorId: string, workspaceId: string, commandId: string, adoptedAt: string, adoptedRecords: ReturnType<typeof crewWorkerAdoptedRecords> }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function command(raw: unknown): CrewWorkerImportCommand {
  if (!object(raw) || Object.keys(raw).sort().join(',') !== 'action,actorId,commandId,referenceMappings,source,workspaceId'
    || !['preflight', 'adopt'].includes(String(raw.action)) || typeof raw.actorId !== 'string' || typeof raw.workspaceId !== 'string'
    || !Array.isArray(raw.referenceMappings) || !object(raw.source)) {
    fail('validation-failed', '工人班组迁入命令字段不完整或包含未知字段。')
  }
  parseResolveCommandBody({ commandId: raw.commandId })
  for (const mapping of raw.referenceMappings) {
    if (!object(mapping) || Object.keys(mapping).sort().join(',') !== 'entityType,legacyId,serverId,version' || mapping.entityType !== 'projects'
      || !/^[A-Z0-9][\w-]{2,79}$/i.test(String(mapping.legacyId)) || !/^[A-Z0-9][\w-]{2,79}$/i.test(String(mapping.serverId)) || !/^[1-9]\d*$/.test(String(mapping.version))) {
      fail('validation-failed', '项目必须使用明确稳定 ID 及实际版本映射，不能按同名采用。')
    }
  }
  if (new Set(raw.referenceMappings.map(mapping => mapping.legacyId)).size !== raw.referenceMappings.length)
    fail('validation-failed', '同一原项目不能采用多份映射。')
  return { ...raw, referenceMappings: [...raw.referenceMappings].sort((left, right) => String(left.legacyId).localeCompare(String(right.legacyId))) } as unknown as CrewWorkerImportCommand
}
function projectIds(graph: CrewWorkerSourceGraph) {
  const ids = new Set<string>()
  for (const worker of graph.workers) {
    if (typeof worker.current_project_id === 'string' && worker.current_project_id)
      ids.add(worker.current_project_id)
  }
  for (const row of graph.archives) {
    ids.add(String(row.project_id))
    const archive = JSON.parse(String(row.snapshot_json)) as import('../../app/lib/worker-roster/contract').WorkerRosterArchive
    for (const member of archive.members) {
      if (member.profile?.currentProjectId)
        ids.add(member.profile.currentProjectId)
    }
  }
  return [...ids].sort()
}
export function createProductionCrewWorkerImport(storage: ProductionStorage) {
  function authorize(session: Session) {
    const actor = session()
    if (actor.workspaceId !== storage.identity.workspaceId || actor.actorId !== storage.identity.actorId || !['core:migration:write', 'worker:sensitive:read', 'worker:list:read', 'crew:list:read'].every(cap => actor.capabilities.includes(cap)))
      fail('forbidden', '当前身份没有此正式工作区的工人班组迁入及私密核验权限。')
    return structuredClone(actor)
  }
  const recheck = (session: Session, actor: BusinessSession) => {
    if (!isDeepStrictEqual(authorize(session), actor))
      fail('forbidden', '迁入期间身份、来源或权限变化，本次写入已撤回。')
  }
  async function previous(tx: TransactionDb, actor: BusinessSession, commandId: string) {
    const [row] = await tx.select<{ fingerprint: string, result_json: string }>('SELECT fingerprint,result_json FROM crew_worker_import_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, commandId])
    return row
  }
  return {
    async state(session: Session) {
      const actor = authorize(session)
      return storage.withTransaction(async (tx) => {
        await validateProductionCrewWorkerJournal(tx, storage.identity)
        const references = actor.capabilities.includes('project:list:read') ? await listMigrationReferences(tx, actor, 'projects') : []
        const sources = await tx.select<{ source_sha256: string, schema_version: number, created_at: string }>('SELECT source_sha256,schema_version,created_at FROM crew_worker_import_sources ORDER BY created_at,source_sha256')
        recheck(session, actor)
        return { context: { workspaceId: actor.workspaceId, actorId: actor.actorId, capabilities: [...actor.capabilities] }, references, sources }
      })
    },
    async execute(raw: unknown, session: Session): Promise<CrewWorkerImportPreview | CrewWorkerImportResult> {
      const actor = authorize(session)
      const input = command(raw)
      if (input.actorId !== actor.actorId || input.workspaceId !== actor.workspaceId)
        fail('forbidden', '迁入命令与当前授权身份不一致。')
      if (input.action === 'adopt')
        storage.assertBusinessWrite()
      return withVerifiedMigrationSnapshot(input.source, async (sourceTx, evidence) => {
        if (evidence.schemaVersion < CREW_WORKER_IMPORT_SCHEMA_RANGE.min || evidence.schemaVersion > CREW_WORKER_IMPORT_SCHEMA_RANGE.max)
          fail('validation-failed', '本 Native 版本尚未完成工人班组来源结构核验，请保留原库。')
        const { graph, originals } = await readCrewWorkerSourceGraph(sourceTx)
        const required = projectIds(graph)
        graph.projects = graph.projects.filter(row => required.includes(String(row.id)))
        return storage.withTransaction(async (tx) => {
          const fingerprint = rosterHash({ sourceSha256: evidence.sha256, schemaVersion: evidence.schemaVersion, referenceMappings: input.referenceMappings })
          if (input.action === 'adopt') {
            const receipt = await previous(tx, actor, input.commandId)
            if (receipt) {
              if (receipt.fingerprint !== fingerprint)
                fail('conflict', '同一迁入原编号不能改用其他来源、映射或版本。')
              await validateProductionCrewWorkerJournal(tx, storage.identity)
              recheck(session, actor)
              return JSON.parse(receipt.result_json) as CrewWorkerImportResult
            }
            if ((await tx.select('SELECT command_id FROM crew_worker_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, input.commandId])).length)
              fail('conflict', '原迁入编号已核对为未应用并封存，迟到请求不能写入。')
          }
          const reasons: string[] = []
          const mappings = new Map<string, string>()
          const confirmed: SourceEvidence['referenceMappings'] = []
          for (const legacyId of required) {
            const mapping = input.referenceMappings.find(row => row.legacyId === legacyId)
            if (!mapping) {
              reasons.push(`原项目 ${legacyId} 尚未明确对应当前项目。`)
              continue
            }
            const target = await readMigrationReference(tx, actor, 'projects', mapping.serverId)
            if (!target || target.version !== mapping.version) {
              reasons.push(`原项目 ${legacyId} 的目标不存在或版本变化，请重新核对。`)
              continue
            }
            mappings.set(legacyId, target.serverId)
            confirmed.push({ ...mapping, sourceVersion: target.sourceVersion })
          }
          if (input.referenceMappings.some(mapping => !required.includes(mapping.legacyId)))
            reasons.push('映射包含本域没有引用的项目，不能扩大采用范围。')
          // Source identity and original archives are retained even if they are soft-deleted.
          const records = crewWorkerAdoptedRecords(graph, mappings, evidence.sha256, actor)
          const current = await loadProductionCrewWorkers(tx, actor)
          for (const [kind, rows] of [['crew', records.crews], ['worker', records.workers]] as const) {
            for (const record of rows) {
              const existing = kind === 'crew' ? current.crews.get(record.id) : current.workers.get(record.id)
              if (existing)
                reasons.push(`${kind === 'crew' ? '班组' : '工人'} ${record.id} 已在中央目录存在，请先核对已有采用来源。`)
            }
          }
          if ((await tx.select('SELECT source_sha256 FROM crew_worker_import_sources WHERE source_sha256=?', [evidence.sha256])).length)
            reasons.push('此完整来源已采用，请读取原迁入结果，不能建立第二份目录。')
          const preview: CrewWorkerImportPreview = { sourceSha256: evidence.sha256, schemaVersion: evidence.schemaVersion, crews: records.crews.map(record => ({ id: record.id, name: record.draft.name ?? '', deleted: !!record.deletedAt })), workers: records.workers.map(record => ({ id: record.id, name: record.draft.name ?? '', deleted: !!record.deletedAt })), projects: required.map(legacyId => ({ legacyId, label: String(graph.projects.find(row => row.id === legacyId)?.name ?? legacyId) })), originalCount: originals.length, archiveCount: graph.archives.length, eligible: !reasons.length, blockingReasons: reasons }
          recheck(session, actor)
          if (input.action === 'preflight')
            return preview
          if (reasons.length)
            fail('conflict', reasons.join(' '))
          const timestamp = new Date().toISOString()
          const sourceEvidence: SourceEvidence = { sourceSha256: evidence.sha256, schemaVersion: evidence.schemaVersion, referenceMappings: confirmed, actorId: actor.actorId, workspaceId: actor.workspaceId, commandId: input.commandId, adoptedAt: timestamp, adoptedRecords: records }
          await tx.execute('INSERT INTO crew_worker_import_sources VALUES (?,?,?,?,?,?)', [evidence.sha256, evidence.schemaVersion, JSON.stringify(graph), JSON.stringify(sourceEvidence), timestamp, actor.actorId])
          for (const [table, rows] of [['crews', records.crews], ['workers', records.workers]] as const) {
            for (const record of rows)
              await tx.execute(`INSERT INTO ${table}(id,record_json) VALUES (?,?)`, [record.id, JSON.stringify(record)])
          }
          for (const original of originals) {
            const file = original.row
            await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [file.id, 'worker', file.owner_id, file.file_name, file.file_path ?? '', file.file_size, file.mime_type, file.category, file.uploader, file.uploaded_at, file.deleted_at])
            await tx.execute('INSERT INTO file_payloads VALUES (?,?,?)', [file.id, original.bytes, original.sha256])
            const old = graph.assets.find(asset => asset.file_ref_id === file.id && asset.worker_id === file.owner_id)
            await tx.execute('INSERT INTO worker_roster_assets VALUES (?,?,?,?,?,?,?,?)', [importedSourceAssetId(graph, String(file.owner_id), String(file.id)), file.owner_id, file.id, original.sha256, crewWorkerSourceTimestamp(old ? old.created_at : file.uploaded_at), old ? old.legacy_category : file.category, evidence.sha256, old ? old.legacy_deleted_at : file.deleted_at])
          }
          for (const profile of graph.profiles)
            await tx.execute('INSERT INTO worker_roster_profile_versions VALUES (?,?,?,?,?,?)', [profile.worker_id, profile.revision, profile.values_json, profile.created_at, profile.actor_id, evidence.sha256])
          for (const archive of graph.archives) {
            const projection = mappedCrewWorkerArchive(archive, mappings)
            await tx.execute('INSERT INTO worker_roster_archives VALUES (?,?,?,?,?,?)', [archive.id, projection.scope.projectId, rosterHash(projection.scope), archive.version, JSON.stringify(projection), archive.created_at])
          }
          // Native receipts remain verbatim in source_graph_json. Equal actor/workspace
          // strings are not evidence of central authorization and cannot populate its journal.
          await tx.execute('UPDATE crew_worker_revision SET revision=revision+1 WHERE singleton=1')
          const result: CrewWorkerImportResult = { commandId: input.commandId, sourceSha256: evidence.sha256, schemaVersion: evidence.schemaVersion, crewIds: records.crews.map(record => record.id), workerIds: records.workers.map(record => record.id), originalCount: originals.length, archiveIds: graph.archives.map(row => String(row.id)), adoptedAt: timestamp }
          await tx.execute('INSERT INTO crew_worker_import_receipts VALUES (?,?,?,?,?,?,?)', [actor.workspaceId, actor.actorId, input.commandId, fingerprint, evidence.sha256, JSON.stringify(result), timestamp])
          await validateProductionCrewWorkerJournal(tx, storage.identity)
          recheck(session, actor)
          return result
        })
      })
    },
    async resolve(raw: unknown, session: Session): Promise<CrewWorkerImportResolution> {
      const actor = authorize(session)
      const commandId = parseResolveCommandBody(raw)
      storage.assertBusinessWrite()
      return storage.withTransaction(async (tx) => {
        const receipt = await previous(tx, actor, commandId)
        if (receipt) {
          await validateProductionCrewWorkerJournal(tx, storage.identity)
          recheck(session, actor)
          return { outcome: 'applied', result: JSON.parse(receipt.result_json) as CrewWorkerImportResult }
        }
        if (!(await tx.select('SELECT command_id FROM crew_worker_import_resolutions WHERE workspace_id=? AND actor_id=? AND command_id=?', [actor.workspaceId, actor.actorId, commandId])).length)
          await tx.execute('INSERT INTO crew_worker_import_resolutions VALUES (?,?,?,?)', [actor.workspaceId, actor.actorId, commandId, new Date().toISOString()])
        recheck(session, actor)
        return { outcome: 'not-applied', commandId }
      })
    },
  }
}
