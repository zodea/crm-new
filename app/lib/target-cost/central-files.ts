import type { FileRefRecord } from '../forms/file-refs'
import { targetCostProblem } from './central-contract'

export interface BudgetFileDraft {
  fileName: string
  fileSize: number
  mimeType: string
  category?: string
  payloadBase64: string
}
export interface BudgetFileChanges {
  add?: BudgetFileDraft[]
  removeIds?: string[]
  restoreIds?: string[]
}
export interface BudgetFileDTO extends Omit<FileRefRecord, 'filePath' | 'ownerType' | 'fileSize' | 'uploadedAt'> {
  ownerType: 'target_cost'
  fileSize: number | null
  uploadedAt: string | null
  payloadState: 'available' | 'missing'
}
export type BudgetFileContentDTO = {
  fileId: string
  targetCostId: string
  fileName: string
  fileSize: number | null
  mimeType: string
} & ({ state: 'available', payloadBase64: string, sha256: string } | { state: 'missing', reason: 'missing-payload' })

function invalid(message: string): never {
  throw targetCostProblem('validation-failed', message, { files: [message] })
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/** 服务端与命令解码共用同一边界；旧 filePath 只在迁移原图中留痕。 */
export function parseBudgetFileChanges(value: unknown): BudgetFileChanges {
  if (!object(value) || Object.keys(value).some(key => !['add', 'removeIds', 'restoreIds'].includes(key)))
    invalid('附件变更包含未知字段')
  const result: BudgetFileChanges = {}
  for (const key of ['removeIds', 'restoreIds'] as const) {
    const ids = value[key]
    if (ids !== undefined) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id || id.trim() !== id) || new Set(ids).size !== ids.length)
        invalid('附件身份列表无效或重复')
      result[key] = ids as string[]
    }
  }
  if (result.removeIds?.some(id => result.restoreIds?.includes(id)))
    invalid('同一附件不能同时移除和恢复')
  if (value.add !== undefined) {
    if (!Array.isArray(value.add))
      invalid('新增附件必须为列表')
    result.add = value.add.map((file) => {
      if (!object(file) || Object.keys(file).some(key => !['fileName', 'fileSize', 'mimeType', 'category', 'payloadBase64'].includes(key)))
        invalid('新增附件包含未知字段或本地路径')
      if (typeof file.fileName !== 'string' || !file.fileName.trim() || /[\r\n\0]/.test(file.fileName)
        || typeof file.fileSize !== 'number' || !Number.isSafeInteger(file.fileSize) || file.fileSize < 0
        || typeof file.mimeType !== 'string' || /[\r\n\0]/.test(file.mimeType)
        || (file.category !== undefined && typeof file.category !== 'string') || typeof file.payloadBase64 !== 'string') {
        invalid('附件名称、大小、类型或真实正文无效')
      }
      let bytes = ''
      try {
        bytes = atob(file.payloadBase64)
      }
      catch { invalid('附件正文编码无效') }
      if (btoa(bytes) !== file.payloadBase64 || bytes.length !== file.fileSize)
        invalid('附件正文与文件大小不一致')
      return { fileName: file.fileName.trim(), fileSize: file.fileSize, mimeType: file.mimeType.trim(), ...(file.category === undefined ? {} : { category: file.category }), payloadBase64: file.payloadBase64 }
    })
  }
  return result
}
