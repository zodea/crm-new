import type { TransactionDb } from '~/lib/db/coordinator'
import { select } from '~/lib/db/connection'
import {
  logCreate,
  restoreRecord,
  softDelete,
} from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export interface FileRefDraft {
  fileName: string
  filePath?: string
  fileSize?: number
  mimeType?: string
  category?: string
  uploader?: string
  /** 可跨重启读取的持久化正文；legacy filePath 只作迁移留痕，不授予读取权限。 */
  payloadBase64?: string
}

export interface FileRefChanges {
  add?: FileRefDraft[]
  removeIds?: string[]
  restoreIds?: string[]
}

export interface FileRefRecord {
  id: string
  ownerType: string
  ownerId: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  category: string
  uploader: string
  uploadedAt: string
  deletedAt: string | null
}

export interface FileRefContent {
  bytes: Uint8Array
  mimeType: string
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}

function base64ToBytes(content: string): Uint8Array {
  const binary = atob(content)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index)
  return bytes
}

export async function fileRefDraftFromFile(
  file: File,
  extra: Pick<FileRefDraft, 'category' | 'uploader'> = {},
): Promise<FileRefDraft> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    fileName: file.name,
    fileSize: bytes.byteLength,
    mimeType: file.type,
    payloadBase64: bytesToBase64(bytes),
    ...extra,
  }
}

async function assertFileOwner(
  tx: TransactionDb,
  ownerType: string,
  ownerId: string,
  fileId: string,
): Promise<void> {
  const rows = await tx.select<{ id: string }>(`
    SELECT id
    FROM file_refs
    WHERE id = ? AND owner_type = ? AND owner_id = ?
    LIMIT 1
  `, [fileId, ownerType, ownerId])
  if (!rows[0])
    throw new Error('附件不存在或不属于当前记录')
}

export async function applyFileRefChanges(
  tx: TransactionDb,
  ownerType: string,
  ownerId: string,
  changes: FileRefChanges = {},
): Promise<string[]> {
  for (const id of new Set(changes.removeIds ?? [])) {
    await assertFileOwner(tx, ownerType, ownerId, id)
    await softDelete(tx, 'file_refs', id)
  }
  for (const id of new Set(changes.restoreIds ?? [])) {
    await assertFileOwner(tx, ownerType, ownerId, id)
    await restoreRecord(tx, 'file_refs', id)
  }

  const ids: string[] = []
  for (const file of changes.add ?? []) {
    const fileName = file.fileName.trim()
    if (!fileName)
      throw new Error('附件名称不能为空')
    const id = generateId('file_ref')
    await tx.execute(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, file_path, file_size,
        mime_type, category, uploader
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      ownerType,
      ownerId,
      fileName,
      file.filePath?.trim() ?? '',
      Math.max(Number(file.fileSize) || 0, 0),
      file.mimeType?.trim() ?? '',
      file.category?.trim() ?? '',
      file.uploader?.trim() ?? '',
    ])
    await logCreate(tx, 'file_refs', id)
    if (typeof file.payloadBase64 === 'string') {
      await tx.execute(
        `INSERT INTO file_payloads (file_ref_id, encoding, content)
         VALUES (?, 'base64', ?)`,
        [id, file.payloadBase64],
      )
    }
    ids.push(id)
  }
  return ids
}

export async function listFileRefs(
  ownerType: string,
  ownerId: string,
  includeDeleted = false,
): Promise<FileRefRecord[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM file_refs
    WHERE owner_type = ? AND owner_id = ?
      ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
    ORDER BY uploaded_at DESC, id DESC
  `, [ownerType, ownerId])
  return rows.map(row => ({
    id: String(row.id),
    ownerType: String(row.owner_type),
    ownerId: String(row.owner_id),
    fileName: String(row.file_name ?? ''),
    filePath: String(row.file_path ?? ''),
    fileSize: Number(row.file_size) || 0,
    mimeType: String(row.mime_type ?? ''),
    category: String(row.category ?? ''),
    uploader: String(row.uploader ?? ''),
    uploadedAt: String(row.uploaded_at ?? ''),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
  }))
}

export async function listFileRefsByOwnerType(
  ownerType: string,
): Promise<FileRefRecord[]> {
  const rows = await select<Record<string, unknown>>(`
    SELECT *
    FROM file_refs
    WHERE owner_type = ?
      AND deleted_at IS NULL
    ORDER BY uploaded_at DESC, id DESC
  `, [ownerType])
  return rows.map(row => ({
    id: String(row.id),
    ownerType: String(row.owner_type),
    ownerId: String(row.owner_id),
    fileName: String(row.file_name ?? ''),
    filePath: String(row.file_path ?? ''),
    fileSize: Number(row.file_size) || 0,
    mimeType: String(row.mime_type ?? ''),
    category: String(row.category ?? ''),
    uploader: String(row.uploader ?? ''),
    uploadedAt: String(row.uploaded_at ?? ''),
    deletedAt: null,
  }))
}

export async function loadFileRefContent(
  file: Pick<FileRefRecord, 'id' | 'ownerType' | 'ownerId'>,
): Promise<FileRefContent | null> {
  const [payload] = await select<{
    encoding: string | null
    content: string | null
    mime_type: string
  }>(`
    SELECT payload.encoding, payload.content, file.mime_type
    FROM file_refs AS file
    LEFT JOIN file_payloads AS payload ON payload.file_ref_id = file.id
    WHERE file.id = ?
      AND file.owner_type = ?
      AND file.owner_id = ?
      AND file.deleted_at IS NULL
    LIMIT 1
  `, [file.id, file.ownerType, file.ownerId])
  if (typeof payload?.content !== 'string')
    return null
  if (payload.encoding !== 'base64')
    throw new Error(`不支持的附件编码：${payload.encoding}`)
  return {
    bytes: base64ToBytes(payload.content),
    mimeType: payload.mime_type || 'application/octet-stream',
  }
}
