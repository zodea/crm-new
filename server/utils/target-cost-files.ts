import type { TransactionDb } from '../../app/lib/db/coordinator'
import type { BudgetMigrationRow } from '../../app/lib/migration/target-cost-source'
import type { BudgetFileChanges, BudgetFileContentDTO, BudgetFileDTO } from '../../app/lib/target-cost/central-files'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { logOperation } from '../../app/lib/db/soft-delete'
import { BUDGET_MIGRATION_COLUMNS } from '../../app/lib/migration/target-cost-source'
import { targetCostProblem } from '../../app/lib/target-cost/central-contract'
import { parseBudgetFileChanges } from '../../app/lib/target-cost/central-files'
import { generateId } from '../../app/lib/util/id'

type StoredFile = BudgetMigrationRow & { id: string, owner_id: string, file_name: string | null, file_size: number | null, mime_type: string | null, category: string | null, uploader: string | null, uploaded_at: string | null, deleted_at: string | null }
async function ownedFile(tx: TransactionDb, targetCostId: string, fileId: string): Promise<StoredFile> {
  const [file] = await tx.select<StoredFile>(`SELECT ${BUDGET_MIGRATION_COLUMNS.files.join(',')} FROM file_refs WHERE id = ? AND owner_type = 'target_cost' AND owner_id = ?`, [fileId, targetCostId])
  if (!file)
    throw targetCostProblem('not-found', '附件不存在或不属于当前预算版本')
  return file
}
async function payload(tx: TransactionDb, file: StoredFile): Promise<string | null> {
  const [body] = await tx.select<{ encoding: string, content: string }>('SELECT encoding,content FROM file_payloads WHERE file_ref_id = ?', [file.id])
  if (!body)
    return null
  let bytes: Buffer
  try {
    bytes = Buffer.from(body.content, 'base64')
  }
  catch { throw targetCostProblem('unavailable', '预算原件正文损坏，请核对来源') }
  if (body.encoding !== 'base64' || bytes.toString('base64') !== body.content || (file.file_size !== null && bytes.length !== file.file_size))
    throw targetCostProblem('unavailable', '预算原件正文与元数据不一致，请核对来源')
  return body.content
}
export async function loadBudgetFiles(tx: TransactionDb, targetCostId: string): Promise<BudgetFileDTO[]> {
  const files = await tx.select<StoredFile>(`SELECT ${BUDGET_MIGRATION_COLUMNS.files.join(',')} FROM file_refs WHERE owner_type = 'target_cost' AND owner_id = ? ORDER BY uploaded_at,id`, [targetCostId])
  return Promise.all(files.map(async file => ({
    id: file.id,
    ownerType: 'target_cost' as const,
    ownerId: targetCostId,
    fileName: file.file_name ?? '',
    fileSize: file.file_size,
    mimeType: file.mime_type ?? '',
    category: file.category ?? '',
    uploader: file.uploader ?? '',
    uploadedAt: file.uploaded_at,
    deletedAt: file.deleted_at,
    payloadState: (await payload(tx, file)) === null ? 'missing' as const : 'available' as const,
  })))
}
export async function readBudgetFileContent(tx: TransactionDb, targetCostId: string, fileId: string): Promise<BudgetFileContentDTO> {
  const file = await ownedFile(tx, targetCostId, fileId)
  if (file.deleted_at !== null)
    throw targetCostProblem('not-found', '附件已移除，不能读取原件')
  const content = await payload(tx, file)
  const identity = { fileId: file.id, targetCostId, fileName: file.file_name ?? '', fileSize: file.file_size, mimeType: file.mime_type ?? '' }
  return content === null ? { ...identity, state: 'missing', reason: 'missing-payload' } : { ...identity, state: 'available', payloadBase64: content, sha256: createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex') }
}

/** 调用者已经持有预算版本和工作区事务；全部校验、元数据、正文与原权威审计在同一 tx。 */
export async function applyBudgetFileChanges(tx: TransactionDb, targetCostId: string, changes: BudgetFileChanges, context: { actorId: string, timestamp: string }): Promise<string[]> {
  const draft = parseBudgetFileChanges(changes)
  const [owner] = await tx.select('SELECT id FROM target_costs WHERE id = ?', [targetCostId])
  if (!owner)
    throw targetCostProblem('not-found', '预算版本不存在')
  const removed = await Promise.all((draft.removeIds ?? []).map(id => ownedFile(tx, targetCostId, id)))
  const restored = await Promise.all((draft.restoreIds ?? []).map(id => ownedFile(tx, targetCostId, id)))
  if (removed.some(file => file.deleted_at !== null) || restored.some(file => file.deleted_at === null))
    throw targetCostProblem('conflict', '附件状态已变化，请重新核对预算版本')
  for (const [action, files] of [['delete', removed], ['restore', restored]] as const) {
    for (const before of files) {
      const after = { ...before, deleted_at: action === 'delete' ? context.timestamp : null }
      await tx.execute('UPDATE file_refs SET deleted_at = ? WHERE id = ?', [after.deleted_at, before.id])
      await logOperation(tx, { table: 'file_refs', recordId: before.id, action, before, after, operator: context.actorId })
    }
  }
  const ids: string[] = []
  for (const file of draft.add ?? []) {
    const id = generateId('file_ref')
    await tx.execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_path,file_size,mime_type,category,uploader,uploaded_at,deleted_at) VALUES (?,'target_cost',?,?,'',?,?,?,?,?,NULL)`, [id, targetCostId, file.fileName, file.fileSize, file.mimeType, file.category ?? '', context.actorId, context.timestamp])
    await tx.execute('INSERT INTO file_payloads(file_ref_id,encoding,content) VALUES (?,\'base64\',?)', [id, file.payloadBase64])
    const after = await ownedFile(tx, targetCostId, id)
    await logOperation(tx, { table: 'file_refs', recordId: id, action: 'create', after, operator: context.actorId })
    ids.push(id)
  }
  return ids
}
