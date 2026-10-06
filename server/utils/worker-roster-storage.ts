import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { WorkerPhotoAsset, WorkerPhotoUpload, WorkerPrivateValues } from '../../app/lib/worker-roster/contract'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { EMPTY_WORKER_PRIVATE, rosterProblem } from '../../app/lib/worker-roster/contract'
import { parsePrivateValues, rosterCanonical } from '../../app/lib/worker-roster/validation'

export function rosterHash(value: unknown) {
  return createHash('sha256').update(rosterCanonical(value)).digest('hex')
}
export const WORKER_ROSTER_TABLES = ['worker_roster_profile_versions', 'worker_roster_assets', 'worker_roster_archives', 'worker_roster_receipts'] as const
export const WORKER_ROSTER_SCHEMA_STATEMENTS = [
  'CREATE TABLE worker_roster_profile_versions(worker_id TEXT NOT NULL, revision INTEGER NOT NULL, values_json TEXT NOT NULL, created_at TEXT NOT NULL, actor_id TEXT NOT NULL, migration_batch_id TEXT, PRIMARY KEY(worker_id,revision))',
  'CREATE TABLE worker_roster_assets(id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, file_ref_id TEXT NOT NULL, sha256 TEXT, created_at TEXT NOT NULL, legacy_category TEXT, migration_batch_id TEXT, legacy_deleted_at TEXT)',
  'CREATE TABLE worker_roster_archives(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope_key TEXT NOT NULL, version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(scope_key,version))',
  'CREATE TABLE worker_roster_receipts(command_id TEXT NOT NULL, workspace_id TEXT NOT NULL, actor_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, worker_id TEXT, archive_id TEXT, PRIMARY KEY(workspace_id,actor_id,command_id))',
] as const
export async function initializeWorkerRosterSchema(db: TransactionDb) {
  for (const sql of WORKER_ROSTER_SCHEMA_STATEMENTS)
    await db.execute(sql.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '))
}
export function photoBytes(photo: WorkerPhotoUpload): Buffer {
  const bytes = Buffer.from(photo.payloadBase64, 'base64')
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.length !== photo.fileSize || bytes.toString('base64') !== photo.payloadBase64 || !((png && photo.mimeType === 'image/png' && /\.png$/i.test(photo.fileName)) || (jpeg && photo.mimeType === 'image/jpeg' && /\.jpe?g$/i.test(photo.fileName))))
    return rosterProblem('validation-failed', '照片正文、大小和 PNG/JPEG 类型不一致')
  return bytes
}
export async function currentWorkerPrivate(db: TransactionDb, workerId: string): Promise<{ revision: number, values: WorkerPrivateValues }> {
  const [row] = await db.select<{ revision: number, values_json: string }>('SELECT revision,values_json FROM worker_roster_profile_versions WHERE worker_id=? ORDER BY revision DESC LIMIT 1', [workerId])
  if (!row)
    return { revision: 0, values: { ...EMPTY_WORKER_PRIVATE } }
  try {
    return { revision: row.revision, values: parsePrivateValues(JSON.parse(row.values_json)) }
  }
  catch {
    return rosterProblem('unavailable', '工人资料版本损坏，请核对原来源')
  }
}
export async function workerRosterAssets(db: TransactionDb, workerId: string): Promise<WorkerPhotoAsset[]> {
  const rows = await db.select<{ id: string, worker_id: string, file_name: string, mime_type: string, file_size: number | null, sha256: string | null, created_at: string, legacy_category: string | null, content: string | null, encoding: string | null }>(`SELECT asset.*,file.file_name,file.mime_type,file.file_size,payload.content,payload.encoding FROM worker_roster_assets asset JOIN file_refs file ON file.id=asset.file_ref_id AND file.owner_type='worker' AND file.owner_id=asset.worker_id LEFT JOIN file_payloads payload ON payload.file_ref_id=file.id WHERE asset.worker_id=? AND asset.legacy_deleted_at IS NULL ORDER BY asset.created_at,asset.id`, [workerId])
  return rows.map((row) => {
    let actualSize = row.file_size
    if (row.content !== null) {
      const bytes = Buffer.from(row.content, 'base64')
      if (row.encoding !== 'base64' || bytes.toString('base64') !== row.content || (row.file_size !== null && bytes.length !== row.file_size) || createHash('sha256').update(bytes).digest('hex') !== row.sha256)
        return rosterProblem('unavailable', '工人原件正文与摘要不一致，请核对来源')
      actualSize = bytes.length
    }
    return { id: row.id, workerId, fileName: row.file_name, mimeType: row.mime_type, fileSize: actualSize, sha256: row.sha256, createdAt: row.created_at, legacyCategory: row.legacy_category, state: row.content === null ? 'missing' : 'available' }
  })
}
export async function insertWorkerPhoto(db: TransactionDb, workerId: string, upload: WorkerPhotoUpload, actorId: string, createdAt: string): Promise<string> {
  const content = photoBytes(upload)
  const id = `worker-photo-${randomUUID()}`
  const sha256 = createHash('sha256').update(content).digest('hex')
  await db.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES (?,'worker',?,?,'',?,?,'roster-photo',?,?)`, [id, workerId, upload.fileName, content.length, upload.mimeType, actorId, createdAt])
  await db.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES (?,\'base64\',?)', [id, upload.payloadBase64])
  await db.execute('INSERT INTO worker_roster_assets(id,worker_id,file_ref_id,sha256,created_at,legacy_category,migration_batch_id,legacy_deleted_at) VALUES (?,?,?,?,?,NULL,NULL,NULL)', [id, workerId, id, sha256, createdAt])
  return id
}
export async function readWorkerAssetPayload(db: TransactionDb, workerId: string, assetId: string): Promise<string> {
  const [row] = await db.select<{ content: string | null }>(`SELECT payload.content FROM worker_roster_assets asset JOIN file_refs file ON file.id=asset.file_ref_id AND file.owner_type='worker' AND file.owner_id=asset.worker_id LEFT JOIN file_payloads payload ON payload.file_ref_id=file.id WHERE asset.id=? AND asset.worker_id=? AND asset.legacy_deleted_at IS NULL`, [assetId, workerId])
  if (!row?.content)
    return rosterProblem('not-found', '该工人照片缺少正文或不可读取')
  return row.content
}
