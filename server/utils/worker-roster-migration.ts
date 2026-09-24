import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { WorkerPrivateValues } from '../../app/lib/worker-roster/contract'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { projectProblem, ProjectRepositoryProblem } from '../../app/lib/project/repository'
import { EMPTY_WORKER_PRIVATE } from '../../app/lib/worker-roster/contract'
import { parsePrivateValues, rosterObject } from '../../app/lib/worker-roster/validation'
import { importedWorkerPhotoId, insertWorkerModernVersions, prepareWorkerModernRemoval } from './worker-roster-modern-migration'
import { initializeWorkerRosterSchema, photoBytes, rosterHash } from './worker-roster-storage'

interface LegacyFile {
  id: string
  ownerType: string
  ownerId: string
  fileName: string
  filePath: string
  fileSize: number | null
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
  deletedAt: string | null
  payloadEncoding: string | null
  payloadContent: string | null
}
interface Evidence { worker_id: string, batch_id: string, fingerprint: string, source_json: string }
interface RemovedSources { projects: ReadonlySet<string>, workers: ReadonlySet<string>, statements: ReadonlySet<string> }
function invalid(message: string): never {
  throw new ProjectRepositoryProblem(projectProblem('conflict', `工人实名资料迁移：${message}`))
}
function parseJson(value: unknown, label: string): unknown {
  try {
    return JSON.parse(String(value))
  }
  catch {
    return invalid(`${label}不是完整 JSON`)
  }
}
function filesFor(entity: CoreMigrationServerEntityDTO): LegacyFile[] {
  const value = parseJson(entity.attributes.workerFilesJson ?? '[]', '原件清单')
  const ids = new Set<string>()
  if (!Array.isArray(value))
    return invalid('原件清单不是数组')
  return value.map((row) => {
    if (!rosterObject(row) || !['id', 'ownerType', 'ownerId', 'fileName', 'filePath', 'mimeType', 'category', 'uploader', 'uploadedAt'].every(key => typeof row[key] === 'string')
      || !row.id || ids.has(String(row.id)) || row.ownerType !== 'worker' || row.ownerId !== entity.legacyId
      || !(row.fileSize === null || (Number.isSafeInteger(row.fileSize) && Number(row.fileSize) >= 0))
      || !['deletedAt', 'payloadEncoding', 'payloadContent'].every(key => row[key] === null || typeof row[key] === 'string')) {
      return invalid('原件身份、归属、元数据或正文类型无效')
    }
    ids.add(String(row.id))
    return row as unknown as LegacyFile
  })
}
function legacyValues(entity: CoreMigrationServerEntityDTO): WorkerPrivateValues {
  const values = { ...EMPTY_WORKER_PRIVATE }
  if (entity.attributes.workerOriginalJson === undefined)
    return values
  const original = parseJson(entity.attributes.workerOriginalJson, '工人原表')
  if (!rosterObject(original) || original.id !== entity.legacyId || original.name !== entity.name)
    return invalid('工人原表身份与迁入记录不一致')
  if (original.labor_contract_signed !== undefined && original.labor_contract_signed !== null) {
    if (![0, 1].includes(Number(original.labor_contract_signed)) || typeof original.labor_contract_signed !== 'number')
      return invalid('原劳动合同签订状态无效')
    values.laborContractSigned = original.labor_contract_signed === 1
    values.laborContractSignedOn = typeof original.labor_contract_signed_on === 'string' && original.labor_contract_signed_on ? original.labor_contract_signed_on : null
  }
  try {
    return parsePrivateValues(values)
  }
  catch {
    return invalid('原劳动合同签订日期与状态不一致')
  }
}
async function assertNoRemovedReferences(db: TransactionDb, removed: RemovedSources, removedAssets: ReadonlySet<string>) {
  for (const row of await db.select<{ snapshot_json: string }>('SELECT snapshot_json FROM worker_roster_archives')) {
    const archive = parseJson(row.snapshot_json, '已保存名册归档')
    if (!rosterObject(archive) || !rosterObject(archive.scope) || !Array.isArray(archive.scope.statementIds) || !Array.isArray(archive.members))
      return invalid('已有名册归档损坏，不能判定可安全恢复')
    if (removed.projects.has(String(archive.scope.projectId)) || archive.scope.statementIds.some(id => removed.statements.has(String(id)))
      || archive.members.some(member => !rosterObject(member) || removed.workers.has(String(member.workerId)) || !Array.isArray(member.photos) || member.photos.some(photo => !rosterObject(photo) || removedAssets.has(String(photo.id))))) {
      return invalid('已有固定名册引用本批项目、工资、工人或照片，不能恢复删除')
    }
  }
  for (const row of await db.select<{ worker_id: string, values_json: string, migration_batch_id: string | null }>('SELECT worker_id,values_json,migration_batch_id FROM worker_roster_profile_versions')) {
    if (row.migration_batch_id !== null)
      continue
    const values = parseJson(row.values_json, '日常资料版本')
    if (!rosterObject(values) || removed.workers.has(row.worker_id) || [values.portraitId, values.bankCardId].some(id => typeof id === 'string' && removedAssets.has(id)))
      return invalid('本批工人或照片已有日常资料版本，不能恢复删除')
  }
  for (const row of await db.select<{ worker_id: string | null }>('SELECT worker_id FROM worker_roster_receipts WHERE worker_id IS NOT NULL')) {
    if (row.worker_id && removed.workers.has(row.worker_id))
      return invalid('工人已有日常提交回执，不能恢复删除')
  }
  for (const row of await db.select<{ record_id: string }>('SELECT record_id FROM operation_logs WHERE table_name=\'worker_roster_profile_versions\'')) {
    if (removed.workers.has(row.record_id))
      return invalid('工人已有独立实名资料审计，不能恢复删除')
  }
}

/** 在迁移候选 SQL 内执行；与其他 owner 一起提交/放弃，不修改当前可见库。 */
export async function applyWorkerRosterMigration(db: TransactionDb, snapshot: CoreMigrationSnapshotDTO, removed: RemovedSources) {
  await initializeWorkerRosterSchema(db)
  await db.execute('CREATE TABLE IF NOT EXISTS worker_roster_migration_evidence(worker_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,fingerprint TEXT NOT NULL,source_json TEXT NOT NULL)')
  const batchId = snapshot.authority === 'central' ? snapshot.activeBatchId : null
  const entities = batchId ? snapshot.entities.filter(row => row.entityType === 'workers') : []
  const evidence = await db.select<Evidence>('SELECT worker_id,batch_id,fingerprint,source_json FROM worker_roster_migration_evidence')
  const removals = evidence.filter(row => row.batch_id !== batchId || !entities.some(entity => entity.id === row.worker_id))
  const workers = new Set([...removed.workers, ...removals.map(row => row.worker_id)])
  const assets = await db.select<{ id: string, worker_id: string, file_ref_id: string, migration_batch_id: string | null }>('SELECT id,worker_id,file_ref_id,migration_batch_id FROM worker_roster_assets')
  const oldAssets = assets.filter(asset => removals.some(row => row.worker_id === asset.worker_id && row.batch_id === asset.migration_batch_id))
  for (const old of removals) {
    const entity = JSON.parse(old.source_json) as CoreMigrationServerEntityDTO
    if (entity.attributes.workerRosterGraphJson !== undefined)
      continue
    const expected = legacyValues(entity)
    const candidates: Record<'portrait' | 'bank-card', string[]> = { 'portrait': [], 'bank-card': [] }
    for (const file of filesFor(entity)) {
      if (file.deletedAt !== null || (file.category !== 'portrait' && file.category !== 'bank-card'))
        continue
      if (file.payloadEncoding === 'base64' && file.payloadContent !== null) {
        try {
          photoBytes({ fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize ?? Buffer.from(file.payloadContent, 'base64').length, payloadBase64: file.payloadContent })
        }
        catch { continue }
      }
      candidates[file.category].push(importedWorkerPhotoId(entity.id, file.id))
    }
    expected.portraitId = candidates.portrait.length === 1 ? candidates.portrait[0]! : null
    expected.bankCardId = candidates['bank-card'].length === 1 ? candidates['bank-card'][0]! : null
    const versions = await db.select<{ revision: number, values_json: string }>('SELECT revision,values_json FROM worker_roster_profile_versions WHERE worker_id=? AND migration_batch_id=?', [old.worker_id, old.batch_id])
    if (versions.length !== 1 || versions[0]!.revision !== 1 || rosterHash(JSON.parse(versions[0]!.values_json)) !== rosterHash(expected))
      return invalid('原工人迁入资料已被改写，不能恢复删除')
  }
  await prepareWorkerModernRemoval(db, removals)
  await assertNoRemovedReferences(db, { ...removed, workers }, new Set(oldAssets.map(asset => asset.id)))
  for (const old of removals) {
    if (assets.some(asset => asset.worker_id === old.worker_id && asset.migration_batch_id === null))
      return invalid('工人已有日常上传照片，不能恢复删除')
    for (const asset of oldAssets.filter(asset => asset.worker_id === old.worker_id)) {
      await db.execute('DELETE FROM file_payloads WHERE file_ref_id=?', [asset.file_ref_id])
      await db.execute('DELETE FROM file_refs WHERE id=? AND owner_type=\'worker\' AND owner_id=?', [asset.file_ref_id, old.worker_id])
      await db.execute('DELETE FROM worker_roster_assets WHERE id=?', [asset.id])
    }
    await db.execute('DELETE FROM worker_roster_profile_versions WHERE worker_id=? AND migration_batch_id=?', [old.worker_id, old.batch_id])
    await db.execute('DELETE FROM worker_roster_migration_evidence WHERE worker_id=?', [old.worker_id])
  }
  for (const entity of entities) {
    if (entity.batchId !== batchId)
      return invalid('工人批次与活动接管不一致')
    const fingerprint = rosterHash(entity)
    const prior = evidence.find(row => row.worker_id === entity.id && row.batch_id === batchId)
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        return invalid('同批工人原件来源被改写')
      continue
    }
    if ((await db.select('SELECT 1 FROM worker_roster_profile_versions WHERE worker_id=? LIMIT 1', [entity.id])).length || assets.some(asset => asset.worker_id === entity.id))
      return invalid('迁入身份已存在日常实名资料或照片')
    const values = legacyValues(entity)
    const files = filesFor(entity)
    const candidates: Record<'portrait' | 'bank-card', string[]> = { 'portrait': [], 'bank-card': [] }
    for (const file of files) {
      const id = importedWorkerPhotoId(entity.id, file.id)
      const content = file.payloadEncoding === 'base64' ? file.payloadContent : null
      let sha256: string | null = null
      if (content !== null) {
        const bytes = Buffer.from(content, 'base64')
        if (bytes.toString('base64') !== content || (file.fileSize !== null && file.fileSize !== bytes.length))
          return invalid('原件正文与大小不一致')
        sha256 = createHash('sha256').update(bytes).digest('hex')
      }
      await db.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES (?,\'worker\',?,?,?,?,?,?,?,?,?)', [id, entity.id, file.fileName, file.filePath, file.fileSize, file.mimeType, file.category, file.uploader, file.uploadedAt, file.deletedAt])
      if (content !== null)
        await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES (?,\'base64\',?)', [id, content])
      await db.execute('INSERT INTO worker_roster_assets(id,worker_id,file_ref_id,sha256,created_at,legacy_category,migration_batch_id,legacy_deleted_at) VALUES (?,?,?,?,?,?,?,?)', [id, entity.id, id, sha256, file.uploadedAt, file.category, batchId, file.deletedAt])
      if (file.deletedAt === null && (file.category === 'portrait' || file.category === 'bank-card')) {
        if (content !== null) {
          try {
            photoBytes({ fileName: file.fileName, mimeType: file.mimeType, fileSize: file.fileSize ?? Buffer.from(content, 'base64').length, payloadBase64: content })
          }
          catch {
            continue
          }
        }
        candidates[file.category].push(id)
      }
    }
    values.portraitId = candidates.portrait.length === 1 ? candidates.portrait[0]! : null
    values.bankCardId = candidates['bank-card'].length === 1 ? candidates['bank-card'][0]! : null
    if (!await insertWorkerModernVersions(db, entity, batchId!))
      await db.execute('INSERT INTO worker_roster_profile_versions(worker_id,revision,values_json,created_at,actor_id,migration_batch_id) VALUES (?,1,?,?,?,?)', [entity.id, JSON.stringify(values), String(entity.attributes.updatedAt ?? entity.attributes.createdAt ?? '1970-01-01T00:00:00.000Z'), `migration:${batchId}`, batchId])
    await db.execute('INSERT INTO worker_roster_migration_evidence(worker_id,batch_id,fingerprint,source_json) VALUES (?,?,?,?)', [entity.id, batchId, fingerprint, JSON.stringify(entity)])
  }
}
