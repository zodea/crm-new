import type { DataOriginDTO } from '../../types/read-model'
import type { ProjectSupplierWorkbenchQueryDTO } from './read-contract'
import { projectSupplierProblem, ProjectSupplierRepositoryProblem } from './read-contract'

export interface ProjectSupplierFileQuery extends ProjectSupplierWorkbenchQueryDTO {
  relationId: string
  fileId: string
  ownerType: string
  ownerId: string
}

export interface ProjectSupplierFileIdentity {
  dataOrigin: DataOriginDTO
  projectId: string
  supplierId: string
  relationId: string
  fileId: string
  ownerType: string
  ownerId: string
  fileName: string
  fileSize: number
  mimeType: string
  sourceVersion: string
}

export type ProjectSupplierFileContentDTO = ProjectSupplierFileIdentity & (
  | { state: 'available', payloadBase64: string, sha256: string }
  | { state: 'missing', reason: 'missing-payload' | 'not-connected' }
)

export type ProjectSupplierFileContent = ProjectSupplierFileIdentity & (
  | { state: 'available', bytes: Uint8Array, sha256: string }
  | { state: 'missing', reason: 'missing-payload' | 'not-connected' }
)

export interface ProjectSupplierFileRepository {
  getContent: (query: ProjectSupplierFileQuery, options?: { signal?: AbortSignal }) => Promise<ProjectSupplierFileContent>
}

function invalidContent(): never {
  throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('unavailable', '合作档案原件校验失败，请重新读取', true))
}

export function assertFileReadActive(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('原件读取已取消', 'AbortError')
}

export async function decodeProjectSupplierFileContent(
  value: unknown,
  query: ProjectSupplierFileQuery,
  signal?: AbortSignal,
): Promise<ProjectSupplierFileContent> {
  assertFileReadActive(signal)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalidContent()
  const row = value as Record<string, unknown>
  for (const key of ['projectId', 'supplierId', 'relationId', 'fileId', 'ownerType', 'ownerId'] as const) {
    if (row[key] !== query[key])
      return invalidContent()
  }
  if (row.dataOrigin !== query.origin || (query.origin === 'demo' && !query.includeDemo)
    || typeof row.fileName !== 'string' || !row.fileName.trim()
    || typeof row.mimeType !== 'string' || typeof row.sourceVersion !== 'string'
    || !Number.isSafeInteger(row.fileSize) || Number(row.fileSize) < 0) {
    return invalidContent()
  }
  const identity: ProjectSupplierFileIdentity = {
    dataOrigin: query.origin,
    projectId: query.projectId,
    supplierId: query.supplierId,
    relationId: query.relationId,
    fileId: query.fileId,
    ownerType: query.ownerType,
    ownerId: query.ownerId,
    fileName: row.fileName,
    fileSize: Number(row.fileSize),
    mimeType: row.mimeType,
    sourceVersion: row.sourceVersion,
  }
  if (row.state === 'missing' && (row.reason === 'missing-payload' || row.reason === 'not-connected'))
    return { ...identity, state: 'missing', reason: row.reason }
  if (query.ownerType !== 'project_supplier' || query.ownerId !== query.relationId)
    return invalidContent()
  if (row.state !== 'available' || typeof row.payloadBase64 !== 'string'
    || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) {
    return invalidContent()
  }
  const payload = row.payloadBase64
  if (payload.length > 20_000_000 || payload.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(payload))
    return invalidContent()
  let binary: string
  try {
    binary = atob(payload)
  }
  catch {
    return invalidContent()
  }
  if (btoa(binary) !== payload || binary.length !== identity.fileSize)
    return invalidContent()
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  assertFileReadActive(signal)
  const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (sha256 !== row.sha256)
    return invalidContent()
  return { ...identity, state: 'available', bytes, sha256 }
}
