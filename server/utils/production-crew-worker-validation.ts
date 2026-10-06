import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BusinessSession } from './business-session'
import type { CrewWorkerSourceGraph } from './production-crew-worker-import-source'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { CREW_WORKER_IMPORT_SCHEMA_RANGE } from '../../app/lib/crew-worker/import-contract'
import { decodeRosterArchive } from '../../app/lib/worker-roster/codec'
import { parsePrivateValues, rosterId } from '../../app/lib/worker-roster/validation'
import { isISODateTimeDTO } from '../../app/types/read-model'
import { crewWorkerAdoptedRecords, crewWorkerSourceTimestamp, importedSourceAssetId, mappedCrewWorkerArchive } from './production-crew-worker-import-source'
import { decodeProductionCrewWorkerRecord, productionCrewWorkerFailure as fail, loadProductionCrewWorkers } from './production-crew-worker-record'
import { rosterHash } from './worker-roster-storage'

function parse(json: string) {
  try {
    return JSON.parse(json)
  }
  catch { return fail('unavailable', '正式工人历史 JSON 损坏，不能作为备份证据。') }
}
/** Read-only complete owner validation, shared by runtime import and offline backup verification. */
export async function validateProductionCrewWorkerJournal(tx: TransactionDb, identity: Pick<BusinessSession, 'workspaceId' | 'actorId'>): Promise<void> {
  const actor: BusinessSession = { ...identity, capabilities: ['worker:list:read', 'crew:list:read', 'worker:sensitive:read'] }
  const [metadata] = await tx.select<{ workspace_id: string, owner_id: string }>('SELECT workspace_id,owner_id FROM production_metadata WHERE singleton=1')
  if (!metadata || metadata.workspace_id !== identity.workspaceId || metadata.owner_id !== identity.actorId)
    fail('unavailable', '正式工人备份来源与原授权工作区不一致。')
  const state = await loadProductionCrewWorkers(tx, actor)
  const sources = await tx.select<{ source_sha256: string, schema_version: number, source_graph_json: string, source_evidence_json: string, actor_id: string, created_at: string }>('SELECT * FROM crew_worker_import_sources')
  const imported = sources.map((source) => {
    const graph = parse(source.source_graph_json) as CrewWorkerSourceGraph
    const evidence = parse(source.source_evidence_json)
    if (!/^[a-f0-9]{64}$/.test(source.source_sha256) || !Number.isSafeInteger(source.schema_version) || source.schema_version < CREW_WORKER_IMPORT_SCHEMA_RANGE.min || source.schema_version > CREW_WORKER_IMPORT_SCHEMA_RANGE.max
      || source.actor_id !== identity.actorId || evidence.actorId !== identity.actorId || evidence.workspaceId !== identity.workspaceId || evidence.sourceSha256 !== source.source_sha256 || evidence.schemaVersion !== source.schema_version || evidence.adoptedAt !== source.created_at || !isISODateTimeDTO(source.created_at)
      || !rosterId(evidence.commandId) || !Array.isArray(evidence.referenceMappings)) {
      fail('unavailable', '工人原库来源、确认操作者或实际映射证据损坏。')
    }
    const mapping = new Map<string, string>(evidence.referenceMappings.map((row: { entityType: string, legacyId: string, serverId: string, version: string, sourceVersion: string }) => {
      if (row.entityType !== 'projects' || !rosterId(row.legacyId) || !rosterId(row.serverId) || !/^[1-9]\d*$/.test(row.version) || typeof row.sourceVersion !== 'string' || !row.sourceVersion)
        fail('unavailable', '工人原项目映射缺少稳定目标或实际采用版本。')
      return [row.legacyId, row.serverId]
    }))
    const records = crewWorkerAdoptedRecords(graph, mapping, source.source_sha256, actor)
    if (!isDeepStrictEqual(records, evidence.adoptedRecords))
      fail('unavailable', '工人迁入采用投影与原图或明确映射不一致。')
    return { source, graph, evidence, mapping, records }
  })
  for (const worker of state.workers.values()) {
    if (worker.draft.crewId && !state.crews.has(worker.draft.crewId))
      fail('unavailable', '正式工人班组稳定关系断裂，不能发布完整备份。')
  }
  const assets = await tx.select<{ id: string, worker_id: string, file_ref_id: string, sha256: string | null, created_at: string, legacy_category: string | null }>('SELECT * FROM worker_roster_assets ORDER BY id')
  const byAsset = new Map(assets.map(row => [row.id, row]))
  const originalMetadata = new Map<string, object>()
  for (const asset of assets) {
    const file = (await tx.select<{ owner_type: string, owner_id: string, file_name: string, mime_type: string, file_size: number, content: Uint8Array | null, sha256: string | null }>('SELECT f.owner_type,f.owner_id,f.file_name,f.mime_type,f.file_size,p.content,p.sha256 FROM file_refs f LEFT JOIN file_payloads p ON p.file_ref_id=f.id WHERE f.id=?', [asset.file_ref_id]))[0]
    if (!state.workers.has(asset.worker_id) || !file || file.owner_type !== 'worker' || file.owner_id !== asset.worker_id || !isISODateTimeDTO(asset.created_at)
      || !(file.content instanceof Uint8Array) || file.content.length !== file.file_size || file.sha256 !== asset.sha256 || createHash('sha256').update(file.content).digest('hex') !== file.sha256) {
      fail('unavailable', '工人原件的精确 owner、字节、大小或摘要不完整。')
    }
    originalMetadata.set(asset.id, { id: asset.id, workerId: asset.worker_id, fileName: file.file_name, mimeType: file.mime_type, fileSize: file.file_size, sha256: asset.sha256, createdAt: asset.created_at, legacyCategory: asset.legacy_category, state: 'available' })
  }
  for (const file of await tx.select<{ id: string, owner_id: string }>('SELECT id,owner_id FROM file_refs WHERE owner_type=\'worker\'')) {
    if (!state.workers.has(file.owner_id) || !assets.some(asset => asset.file_ref_id === file.id && asset.worker_id === file.owner_id))
      fail('unavailable', '工人原件缺少登记名册身份或精确归属。')
  }
  const profiles = await tx.select<{ worker_id: string, revision: number, values_json: string, created_at: string, actor_id: string }>('SELECT * FROM worker_roster_profile_versions ORDER BY worker_id,revision')
  for (const profile of profiles) {
    if (!state.workers.has(profile.worker_id) || !Number.isSafeInteger(profile.revision) || profile.revision < 1 || !isISODateTimeDTO(profile.created_at) || !rosterId(profile.actor_id))
      fail('unavailable', '工人私密资料冻结版本或身份不完整。')
    const values = parsePrivateValues(parse(profile.values_json))
    for (const id of [values.portraitId, values.bankCardId]) {
      if (id !== null && byAsset.get(id)?.worker_id !== profile.worker_id)
        fail('unavailable', '工人冻结资料引用了其他人的原件。')
    }
  }
  const archives = await tx.select<{ id: string, project_id: string, version: number, snapshot_json: string, created_at: string }>('SELECT * FROM worker_roster_archives ORDER BY id')
  for (const row of archives) {
    const document = decodeRosterArchive(parse(row.snapshot_json), row.project_id, row.id)
    if (document.version !== row.version || document.createdAt !== row.created_at)
      fail('unavailable', '工人归档头与原冻结快照不一致。')
    for (const member of document.members) {
      if (!state.workers.has(member.workerId))
        fail('unavailable', '冻结名册工人稳定身份未保全。')
      for (const photo of member.photos) {
        const original = byAsset.get(photo.id)
        if (!original || original.worker_id !== member.workerId || original.sha256 !== photo.sha256)
          fail('unavailable', '冻结名册原件与工人或原摘要不一致。')
      }
    }
  }
  for (const receipt of await tx.select<{ command_id: string, workspace_id: string, actor_id: string, fingerprint: string, result_json: string, worker_id: string | null, archive_id: string | null }>('SELECT * FROM worker_roster_receipts')) {
    if (!rosterId(receipt.command_id) || receipt.workspace_id !== identity.workspaceId || receipt.actor_id !== identity.actorId)
      fail('unavailable', '工人实名回执不属于原授权工作区或维护人。')
    if (receipt.fingerprint === 'cancelled' && receipt.result_json === 'null' && receipt.worker_id === null && receipt.archive_id === null)
      continue
    const result = parse(receipt.result_json)
    if (!/^[a-f0-9]{64}$/.test(receipt.fingerprint) || !result || result.commandId !== receipt.command_id || result.workerId !== receipt.worker_id || result.archiveId !== receipt.archive_id || !Number.isSafeInteger(result.revision) || result.revision < 1
      || Boolean(receipt.worker_id) === Boolean(receipt.archive_id)
      || (receipt.worker_id && !profiles.some(row => row.worker_id === receipt.worker_id && row.revision === result.revision))
      || (receipt.archive_id && !archives.some(row => row.id === receipt.archive_id && row.version === result.revision))) {
      fail('unavailable', '工人实名原回执与冻结资料版本或名册归档不一致。')
    }
  }
  for (const source of imported) {
    const [receipt] = await tx.select<{ fingerprint: string, result_json: string, source_sha256: string }>('SELECT fingerprint,result_json,source_sha256 FROM crew_worker_import_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [identity.workspaceId, identity.actorId, source.evidence.commandId])
    const plainMappings = source.evidence.referenceMappings.map(({ sourceVersion: _version, ...row }: { sourceVersion: string }) => row)
    const result = receipt ? parse(receipt.result_json) : null
    if (!receipt || receipt.source_sha256 !== source.source.source_sha256 || receipt.fingerprint !== rosterHash({ sourceSha256: source.source.source_sha256, schemaVersion: source.source.schema_version, referenceMappings: plainMappings })
      || !result || result.commandId !== source.evidence.commandId || result.sourceSha256 !== source.source.source_sha256 || result.schemaVersion !== source.source.schema_version || result.adoptedAt !== source.source.created_at
      || !isDeepStrictEqual(result.crewIds, source.records.crews.map(row => row.id)) || !isDeepStrictEqual(result.workerIds, source.records.workers.map(row => row.id)) || result.originalCount !== source.graph.files.length || !isDeepStrictEqual(result.archiveIds, source.graph.archives.map(row => row.id))) {
      fail('unavailable', '工人迁入来源与实际原命令回执不一致。')
    }
    for (const archive of source.graph.archives) {
      const adopted = archives.find(row => row.id === archive.id)
      if (!adopted || !isDeepStrictEqual(parse(adopted.snapshot_json), mappedCrewWorkerArchive(archive, source.mapping)))
        fail('unavailable', '迁入名册投影与原冻结正文或明确项目绑定不一致。')
    }
    for (const profile of source.graph.profiles) {
      const adopted = profiles.find(row => row.worker_id === profile.worker_id && row.revision === profile.revision)
      if (!adopted || adopted.values_json !== profile.values_json || adopted.actor_id !== profile.actor_id || adopted.created_at !== profile.created_at)
        fail('unavailable', '迁入工人私密冻结历史被改写或遗漏。')
    }
    for (const file of source.graph.files) {
      const id = importedSourceAssetId(source.graph, String(file.owner_id), String(file.id))
      const old = source.graph.assets.find(row => row.id === id)
      const expected = { id, workerId: file.owner_id, fileName: file.file_name, mimeType: file.mime_type, fileSize: file.file_size, sha256: file.payload_sha256, createdAt: crewWorkerSourceTimestamp(old ? old.created_at : file.uploaded_at), legacyCategory: old ? old.legacy_category : file.category, state: 'available' }
      if (!isDeepStrictEqual(originalMetadata.get(id), expected))
        fail('unavailable', '迁入工人原件元数据、冻结归属或来源正文采用证据不一致。')
    }
  }
  const audits = await tx.select<{ kind: 'crew' | 'worker', entity_id: string, actor_id: string, command_id: string, before_json: string | null, after_json: string, created_at: string }>('SELECT * FROM crew_worker_audits')
  for (const audit of audits) {
    if (audit.actor_id !== identity.actorId || !rosterId(audit.command_id) || !isISODateTimeDTO(audit.created_at))
      fail('unavailable', '工人审计的原身份或时间不完整。')
    const value = parse(audit.after_json)
    if (value.result) {
      const [receipt] = await tx.select<{ result_json: string }>('SELECT result_json FROM worker_roster_receipts WHERE workspace_id=? AND actor_id=? AND command_id=?', [identity.workspaceId, identity.actorId, audit.command_id])
      if (!receipt || !isDeepStrictEqual(parse(receipt.result_json), value.result) || (value.result.workerId ?? value.result.archiveId) !== audit.entity_id)
        fail('unavailable', '工人实名审计与同事务原回执不一致。')
      if (value.result.workerId) {
        const profile = profiles.find(row => row.worker_id === value.result.workerId && row.revision === value.result.revision)
        if (!profile || !isDeepStrictEqual(parse(profile.values_json), value.profileValues) || !Array.isArray(value.originals))
          fail('unavailable', '工人私密原版本与同事务审计采用证据不一致。')
        for (const original of value.originals) {
          if (!isDeepStrictEqual(originalMetadata.get(original.id), original))
            fail('unavailable', '工人原件与同事务审计中的原名称、类型、大小或摘要不一致。')
        }
      }
    }
    else {
      const record = decodeProductionCrewWorkerRecord(audit.kind, audit.entity_id, audit.after_json, actor)
      const [receipt] = await tx.select<{ result_json: string }>('SELECT result_json FROM crew_worker_command_receipts WHERE workspace_id=? AND actor_id=? AND kind=? AND command_id=?', [identity.workspaceId, identity.actorId, audit.kind, audit.command_id])
      if (!receipt || parse(receipt.result_json).version !== String(record.version) || parse(receipt.result_json).updatedAt !== record.updatedAt)
        fail('unavailable', '目录审计与同事务原版本回执不一致。')
      if (audit.before_json)
        decodeProductionCrewWorkerRecord(audit.kind, audit.entity_id, audit.before_json, actor)
    }
  }
  for (const asset of assets) {
    const adopted = imported.some(source => source.graph.files.some(file => importedSourceAssetId(source.graph, String(file.owner_id), String(file.id)) === asset.id))
    const journaled = audits.some(row => parse(row.after_json).originals?.some((original: { id: string }) => original.id === asset.id))
    if (!adopted && !journaled)
      fail('unavailable', '工人原件缺少原采用图或同事务命令归属证据。')
  }
  for (const profile of profiles) {
    const inherited = imported.some(source => source.graph.profiles.some(row => row.worker_id === profile.worker_id && row.revision === profile.revision && row.values_json === profile.values_json && row.actor_id === profile.actor_id && row.created_at === profile.created_at))
    const journaled = audits.some((row) => {
      const value = parse(row.after_json)
      return value.result?.workerId === profile.worker_id && value.result?.revision === profile.revision && isDeepStrictEqual(value.profileValues, parse(profile.values_json))
    })
    if (!inherited && !journaled)
      fail('unavailable', '工人冻结私密版本缺少原采用图或同事务命令证据。')
  }
  for (const [kind, records] of [['crew', state.crews], ['worker', state.workers]] as const) {
    for (const [id, current] of records) {
      const journaled = audits.filter(row => row.kind === kind && row.entity_id === id && !parse(row.after_json).result)
      const original = imported.flatMap(source => kind === 'crew' ? source.records.crews : source.records.workers).find(record => record.id === id)
      const ordered = journaled.sort((left, right) => parse(left.after_json).version - parse(right.after_json).version)
      let previous = original ?? null
      for (const audit of ordered) {
        const next = parse(audit.after_json)
        if (!isDeepStrictEqual(audit.before_json ? parse(audit.before_json) : null, previous) || next.version !== (previous?.version ?? 0) + 1)
          fail('unavailable', '工人主档完整审计版本链断裂，不能发布备份。')
        previous = next
      }
      if (!previous || !isDeepStrictEqual(current, previous))
        fail('unavailable', '工人现行主档缺少原采用图或完整命令审计链。')
    }
  }
}
