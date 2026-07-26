import type { TransactionDb } from '~/lib/db/coordinator'
import { isTauri } from '@tauri-apps/api/core'
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
  /** 浏览器模式的持久化正文；桌面端优先保留 filePath，避免重复占用 SQLite。 */
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
    if (file.payloadBase64) {
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
  file: Pick<FileRefRecord, 'id' | 'filePath' | 'mimeType'>,
): Promise<FileRefContent | null> {
  const [payload] = await select<{ encoding: string, content: string }>(`
    SELECT encoding, content
    FROM file_payloads
    WHERE file_ref_id = ?
    LIMIT 1
  `, [file.id])
  if (payload) {
    if (payload.encoding !== 'base64')
      throw new Error(`不支持的附件编码：${payload.encoding}`)
    return {
      bytes: base64ToBytes(payload.content),
      mimeType: file.mimeType || 'application/octet-stream',
    }
  }
  if (!file.filePath || !isTauri())
    return null
  const { readFile } = await import('@tauri-apps/plugin-fs')
  return {
    bytes: await readFile(file.filePath),
    mimeType: file.mimeType || 'application/octet-stream',
  }
}
