import type { ProblemDTO } from '../../types/read-model'
import type { SoftDb } from '../db/soft-delete'
import type { QuantityCompletionPhotoDraft } from './completion'
import { hiddenCtes, visibleCond } from '../db/soft-delete'
import { quantityProblem } from './central-contract'

export interface QuantityPhotoIdentity {
  projectId: string
  unitId: string
  completionId: string
  photoId: string
}

export interface QuantityPhotoContent extends QuantityPhotoIdentity, QuantityCompletionPhotoDraft {
  sha256: string
}

export function validateQuantityPhoto(photo: QuantityCompletionPhotoDraft, code: ProblemDTO['code'] = 'validation-failed'): Uint8Array {
  const fail = (): never => {
    throw quantityProblem(code, '验收照片名称、类型、大小或正文不符，请重新选择文件')
  }
  if (!photo || typeof photo.fileName !== 'string' || !photo.fileName.trim()
    || typeof photo.mimeType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(photo.mimeType)
    || !Number.isSafeInteger(photo.fileSize) || photo.fileSize <= 0
    || typeof photo.contentBase64 !== 'string' || photo.contentBase64.length > 20_000_000
    || !/^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i.test(photo.contentBase64)) {
    return fail()
  }
  let binary: string
  try {
    binary = atob(photo.contentBase64)
  }
  catch {
    return fail()
  }
  if (btoa(binary) !== photo.contentBase64 || binary.length !== photo.fileSize)
    return fail()
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** 正文只通过当前可见的业务祖先读取，无法取回的历史原件保留明确错误。 */
export async function readQuantityCentralPhoto(db: SoftDb, query: QuantityPhotoIdentity): Promise<QuantityPhotoContent> {
  const [row] = await db.select<{ file_name: string, mime_type: string, file_size: number, encoding: string | null, content: string | null }>(`
    ${hiddenCtes('unit_stage_completions')}
    SELECT fr.file_name, fr.mime_type, fr.file_size, fp.encoding, fp.content
    FROM file_refs fr
    JOIN unit_stage_completions done ON done.id = fr.owner_id
    JOIN construction_stages stage ON stage.id = done.stage_id
    JOIN units unit ON unit.id = done.unit_id
    JOIN floors floor_row ON floor_row.id = unit.floor_id
    JOIN buildings building ON building.id = floor_row.building_id
    JOIN house_type_templates template ON template.id = unit.house_type_template_id
    LEFT JOIN file_payloads fp ON fp.file_ref_id = fr.id
    WHERE fr.id = ? AND done.id = ? AND unit.id = ?
      AND building.project_id = ? AND template.project_id = ? AND stage.project_id = ?
      AND fr.owner_type = 'unit_stage_completion' AND fr.category = 'acceptance_photo'
      AND fr.deleted_at IS NULL AND ${visibleCond('unit_stage_completions', 'done')}
  `, [query.photoId, query.completionId, query.unitId, query.projectId, query.projectId, query.projectId])
  if (!row)
    throw quantityProblem('not-found', '验收照片不存在、已删除或不属于当前户与阶段完成')
  if (row.content === null)
    throw quantityProblem('not-found', '历史验收照片未保存正文，当前无法预览，请重新上传')
  if (row.encoding !== 'base64')
    throw quantityProblem('internal-error', '验收照片正文编码不受支持')
  const photo = { fileName: row.file_name, mimeType: row.mime_type, fileSize: row.file_size, contentBase64: row.content }
  const bytes = validateQuantityPhoto(photo, 'internal-error')
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { ...query, ...photo, sha256 }
}
