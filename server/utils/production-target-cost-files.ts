import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BudgetFileChanges, BudgetFileContentDTO, BudgetFileDTO } from '../../app/lib/target-cost/central-files'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { logOperation } from '../../app/lib/db/soft-delete'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { parseBudgetFileChanges } from '../../app/lib/target-cost/central-files'
import { generateId } from '../../app/lib/util/id'

export const budgetDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry)).digest('hex')
export const budgetBytesDigest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
type FileRow = Record<string, unknown> & { id: string, owner_id: string, original_metadata_json: string, body_state: string, sha256: string | null, content: Uint8Array | null, payload_sha256: string | null, deleted_at: string | null }

async function files(tx: TransactionDb, id: string) {
  return tx.select<FileRow>(`SELECT f.*,b.original_metadata_json,b.body_state,b.sha256,p.content,p.sha256 AS payload_sha256 FROM target_cost_files b
    JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=f.id
    WHERE b.target_cost_id=? ORDER BY f.uploaded_at,f.id`, [id])
}
function verified(row: FileRow, id: string) {
  let metadata: Record<string, unknown>
  try {
    metadata = JSON.parse(row.original_metadata_json)
  }
  catch { throw targetCostProblem('unavailable', '预算原件的历史元数据损坏') }
  if (!metadata || metadata.id !== row.id || metadata.owner_type !== 'target_cost' || metadata.owner_id !== id || row.owner_type !== 'target_cost' || row.owner_id !== id)
    throw targetCostProblem('unavailable', '预算原件归属与稳定身份不完整')
  if (row.body_state === 'metadata-only') {
    if (row.content !== null || row.sha256 !== null || row.payload_sha256 !== null)
      throw targetCostProblem('unavailable', '预算历史缺件证据与当前正文不一致')
  }
  else if (row.body_state !== 'embedded' || !(row.content instanceof Uint8Array) || row.content.length !== row.file_size || budgetBytesDigest(row.content) !== row.sha256 || row.sha256 !== row.payload_sha256 || (metadata.file_size !== null && metadata.file_size !== row.content.length)) {
    throw targetCostProblem('unavailable', '预算原件字节、大小或摘要不一致')
  }
  return metadata
}
export async function loadProductionBudgetFiles(tx: TransactionDb, id: string): Promise<BudgetFileDTO[]> {
  return (await files(tx, id)).map((row) => {
    const original = verified(row, id)
    return { id: row.id, ownerType: 'target_cost', ownerId: id, fileName: String(original.file_name ?? ''), fileSize: original.file_size == null ? null : Number(original.file_size), mimeType: String(original.mime_type ?? ''), category: String(original.category ?? ''), uploader: String(original.uploader ?? ''), uploadedAt: original.uploaded_at == null ? null : String(original.uploaded_at), deletedAt: row.deleted_at, payloadState: row.body_state === 'embedded' ? 'available' : 'missing' }
  })
}
export async function readProductionBudgetFile(tx: TransactionDb, id: string, fileId: string): Promise<BudgetFileContentDTO> {
  const row = (await files(tx, id)).find(row => row.id === fileId)
  if (!row || row.deleted_at !== null)
    throw targetCostProblem('not-found', '附件不存在、已移除或不属于当前预算')
  const original = verified(row, id)
  const identity = { fileId, targetCostId: id, fileName: String(original.file_name ?? ''), fileSize: original.file_size == null ? null : Number(original.file_size), mimeType: String(original.mime_type ?? '') }
  return row.content === null ? { ...identity, state: 'missing', reason: 'missing-payload' } : { ...identity, state: 'available', payloadBase64: Buffer.from(row.content).toString('base64'), sha256: row.sha256! }
}
export async function applyProductionBudgetFiles(tx: TransactionDb, id: string, changes: BudgetFileChanges, actorId: string) {
  const parsed = parseBudgetFileChanges(changes)
  const owned = await files(tx, id)
  const timestamp = new Date().toISOString()
  for (const [action, ids] of [['delete', parsed.removeIds ?? []], ['restore', parsed.restoreIds ?? []]] as const) {
    for (const fileId of ids) {
      const file = owned.find(row => row.id === fileId)
      if (!file || (action === 'delete' ? file.deleted_at !== null : file.deleted_at === null))
        throw targetCostProblem('conflict', '预算附件归属或删除状态已变化')
      verified(file, id)
      const before = (await tx.select<Record<string, unknown>>('SELECT * FROM file_refs WHERE id=?', [fileId]))[0]!
      const after = { ...before, deleted_at: action === 'delete' ? timestamp : null }
      await tx.execute('UPDATE file_refs SET deleted_at=? WHERE id=?', [after.deleted_at, fileId])
      await logOperation(tx, { table: 'file_refs', recordId: fileId, action, before, after, operator: actorId })
    }
  }
  const added: string[] = []
  for (const file of parsed.add ?? []) {
    const bytes = Buffer.from(file.payloadBase64, 'base64')
    const fileId = generateId('file_ref')
    const sha256 = budgetBytesDigest(bytes)
    const metadata = { id: fileId, owner_type: 'target_cost', owner_id: id, file_name: file.fileName, file_path: '', file_size: file.fileSize, mime_type: file.mimeType, category: file.category ?? '', uploader: actorId, uploaded_at: timestamp, deleted_at: null }
    await tx.execute('INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [fileId, 'target_cost', id, file.fileName, '', bytes.length, file.mimeType, file.category ?? '', actorId, timestamp])
    await tx.execute('INSERT INTO file_payloads(file_ref_id,content,sha256) VALUES (?,?,?)', [fileId, bytes, sha256])
    await tx.execute('INSERT INTO target_cost_files VALUES (?,?,?,?,?)', [fileId, id, JSON.stringify(metadata), 'embedded', sha256])
    await logOperation(tx, { table: 'file_refs', recordId: fileId, action: 'create', after: metadata, operator: actorId })
    added.push(fileId)
  }
  return added
}
