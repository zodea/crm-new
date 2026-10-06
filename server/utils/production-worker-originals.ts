import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { WorkerPhotoAsset, WorkerPhotoUpload } from '../../app/lib/worker-roster/contract'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { rosterProblem } from '../../app/lib/worker-roster/contract'
import { photoBytes } from './worker-roster-storage'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
interface PhysicalAsset {
  id: string
  worker_id: string
  file_ref_id: string
  sha256: string | null
  created_at: string
  legacy_category: string | null
  file_name: string
  mime_type: string
  file_size: number
  content: Uint8Array | null
  payload_hash: string | null
}
async function rows(db: TransactionDb, workerId: string): Promise<PhysicalAsset[]> {
  const result = await db.select<PhysicalAsset>(`SELECT asset.*,file.file_name,file.mime_type,file.file_size,payload.content,payload.sha256 AS payload_hash
    FROM worker_roster_assets asset
    JOIN file_refs file ON file.id=asset.file_ref_id AND file.owner_type='worker' AND file.owner_id=asset.worker_id
    LEFT JOIN file_payloads payload ON payload.file_ref_id=file.id
    WHERE asset.worker_id=? AND asset.legacy_deleted_at IS NULL ORDER BY asset.created_at,asset.id`, [workerId])
  const [{ count } = { count: 0 }] = await db.select<{ count: number }>('SELECT COUNT(*) AS count FROM worker_roster_assets WHERE worker_id=? AND legacy_deleted_at IS NULL', [workerId])
  if (count !== result.length)
    rosterProblem('unavailable', '工人原件登记与精确归属不一致，请核对原来源。')
  for (const row of result) {
    if (row.content !== null && (!(row.content instanceof Uint8Array) || row.content.length !== row.file_size || digest(row.content) !== row.sha256 || row.sha256 !== row.payload_hash))
      rosterProblem('unavailable', '工人原件字节、大小或摘要不一致，请核对原来源。')
  }
  return result
}
export const productionWorkerOriginals = {
  async assets(db: TransactionDb, workerId: string): Promise<WorkerPhotoAsset[]> {
    return (await rows(db, workerId)).map(row => ({ id: row.id, workerId, fileName: row.file_name, mimeType: row.mime_type, fileSize: row.file_size, sha256: row.sha256, createdAt: row.created_at, legacyCategory: row.legacy_category, state: row.content === null ? 'missing' : 'available' }))
  },
  async payload(db: TransactionDb, workerId: string, assetId: string): Promise<string> {
    const row = (await rows(db, workerId)).find(row => row.id === assetId)
    if (!row?.content)
      return rosterProblem('not-found', '原件不属于当前工人、缺正文或不可读取。')
    return Buffer.from(row.content).toString('base64')
  },
  async insert(db: TransactionDb, workerId: string, upload: WorkerPhotoUpload, actorId: string, createdAt: string): Promise<string> {
    const bytes = photoBytes(upload)
    const id = `worker-photo-${randomUUID()}`
    const hash = digest(bytes)
    await db.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES (?,'worker',?,?,'',?,?,'roster-photo',?,?)`, [id, workerId, upload.fileName, bytes.length, upload.mimeType, actorId, createdAt])
    await db.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES (?,?,?)', [id, bytes, hash])
    await db.execute('INSERT INTO worker_roster_assets(id,worker_id,file_ref_id,sha256,created_at,legacy_category,migration_batch_id,legacy_deleted_at) VALUES (?,?,?,?,?,NULL,NULL,NULL)', [id, workerId, id, hash, createdAt])
    return id
  },
}
