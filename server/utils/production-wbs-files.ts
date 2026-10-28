import type { TransactionDb } from '../../app/lib/db/coordinator'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { scheduleProblem } from '../../app/lib/schedule/central-contract'

export const wbsBytesDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export async function productionWbsFiles(tx: TransactionDb, projectId?: string) {
  const rows = await tx.select<Record<string, unknown> & { file_ref_id: string, project_id: string, owner_type: string, owner_id: string, original_metadata_json: string, body_state: string, sha256: string | null, content: Uint8Array | null, payload_sha256: string | null, file_size: number | null, deleted_at: string | null }>(`SELECT b.*,f.file_size,f.file_path,f.deleted_at,p.content,p.sha256 AS payload_sha256,f.owner_type AS actual_owner_type,f.owner_id AS actual_owner_id FROM schedule_files b JOIN file_refs f ON f.id=b.file_ref_id LEFT JOIN file_payloads p ON p.file_ref_id=b.file_ref_id ${projectId ? 'WHERE b.project_id=?' : ''} ORDER BY b.file_ref_id`, projectId ? [projectId] : [])
  const metadataOnlyFileIds = new Set<string>()
  const files = []
  for (const row of rows) {
    let original
    try {
      original = JSON.parse(row.original_metadata_json)
    }
    catch { throw scheduleProblem('unavailable', 'WBS原件来源元数据损坏') }
    const owner = (await tx.select<{ project_id: string }>(`SELECT project_id FROM ${row.owner_type === 'schedule_task' ? 'schedule_tasks' : 'schedule_groups'} WHERE id=?`, [row.owner_id]))[0]
    if (!owner || owner.project_id !== row.project_id || !original || original.id !== row.file_ref_id || original.owner_type !== row.owner_type || original.owner_id !== row.owner_id || row.actual_owner_type !== row.owner_type || row.actual_owner_id !== row.owner_id || row.file_path !== (original.file_path ?? ''))
      throw scheduleProblem('unavailable', 'WBS原件稳定身份、来源路径或真实祖先不一致')
    if (row.body_state === 'metadata-only') {
      if (row.content !== null || row.sha256 !== null || row.payload_sha256 !== null || original.file_path)
        throw scheduleProblem('unavailable', 'WBS缺件证据与现有原件正文冲突')
      metadataOnlyFileIds.add(row.file_ref_id)
    }
    else if (row.body_state !== 'embedded' || !(row.content instanceof Uint8Array) || row.file_size !== row.content.length || (original.file_size !== null && original.file_size !== row.content.length) || wbsBytesDigest(row.content) !== row.sha256 || row.payload_sha256 !== row.sha256) {
      throw scheduleProblem('unavailable', 'WBS原件完整字节、大小或摘要不一致')
    }
    files.push({ id: row.file_ref_id, ownerType: row.owner_type, ownerId: row.owner_id, fileName: String(original.file_name ?? ''), fileSize: original.file_size ?? null, mimeType: String(original.mime_type ?? ''), deletedAt: row.deleted_at, payloadState: row.body_state === 'embedded' ? 'available' : 'missing', payloadBase64: row.content ? Buffer.from(row.content).toString('base64') : null, sha256: row.sha256 })
  }
  return { metadataOnlyFileIds, files }
}
