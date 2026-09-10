import type { ProjectSupplierFileContentDTO, ProjectSupplierFileIdentity, ProjectSupplierFileQuery } from '../../app/lib/project-supplier/file-content'
import type { ProjectSupplierFileDTO } from '../../app/lib/project-supplier/read-contract'
import type { DataOriginDTO, ProblemCodeDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { PROJECT_SUPPLIER_READ_CAPABILITY, projectSupplierProblem, ProjectSupplierRepositoryProblem } from '../../app/lib/project-supplier/read-contract'

export interface ProjectSupplierFileReaderPorts {
  readAncestors: (query: ProjectSupplierFileQuery, sessionId?: string | null) => Promise<string>
  readWorkbench: (query: ProjectSupplierFileQuery, sessionId?: string | null) => Promise<{
    dataOrigin: DataOriginDTO
    project: { id: string }
    supplier: { id: string }
    relation: { id: string }
    files: readonly ProjectSupplierFileDTO[]
    sourceVersion: string | null
    capabilities: readonly string[]
  }>
  readPayload: (fileId: string, origin: DataOriginDTO, sessionId?: string | null) => {
    payloadBase64: string
    sha256: string | null
  } | null
}

function fail(code: ProblemCodeDTO, message: string): never {
  throw new ProjectSupplierRepositoryProblem(projectSupplierProblem(code, message, code === 'unavailable'))
}

export function createProjectSupplierFileReader(ports: ProjectSupplierFileReaderPorts) {
  return {
    async getContent(query: ProjectSupplierFileQuery, session: BusinessSession, sessionId?: string | null): Promise<ProjectSupplierFileContentDTO> {
      if (!session.capabilities.includes(PROJECT_SUPPLIER_READ_CAPABILITY)
        || (query.origin === 'demo' && (!query.includeDemo || !session.capabilities.includes('demo:read')))) {
        return fail('forbidden', '无合作档案原件查看权限')
      }
      const ancestorVersion = await ports.readAncestors(query, sessionId)
      const workbench = await ports.readWorkbench(query, sessionId)
      if (!workbench.capabilities.includes(PROJECT_SUPPLIER_READ_CAPABILITY))
        return fail('forbidden', '无合作档案原件查看权限')
      if (workbench.dataOrigin !== query.origin || workbench.project.id !== query.projectId
        || workbench.supplier.id !== query.supplierId || workbench.relation.id !== query.relationId) {
        return fail('relationship-mismatch', '当前合作关系与原件请求不匹配')
      }
      const file = workbench.files.find(row => row.file.id === query.fileId)
      if (!file)
        return fail('not-found', '当前合作关系中未找到该原件')
      if (file.ownerType !== query.ownerType || file.ownerId !== query.ownerId)
        return fail('relationship-mismatch', '原件归属与当前合作关系不匹配')
      const identity: ProjectSupplierFileIdentity = {
        dataOrigin: query.origin,
        projectId: query.projectId,
        supplierId: query.supplierId,
        relationId: query.relationId,
        fileId: file.file.id,
        ownerType: file.ownerType,
        ownerId: file.ownerId,
        fileName: file.file.label,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        sourceVersion: `${ancestorVersion}:${workbench.sourceVersion ?? 'unknown'}`,
      }
      if (file.ownerType !== 'project_supplier')
        return { ...identity, state: 'missing', reason: 'not-connected' }
      if (file.ownerId !== query.relationId)
        return fail('relationship-mismatch', '原件归属与当前合作关系不匹配')
      const payload = ports.readPayload(file.file.id, query.origin, sessionId)
      if (!payload)
        return { ...identity, state: 'missing', reason: 'missing-payload' }
      const base64 = payload.payloadBase64
      if (base64.length > 20_000_000 || base64.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(base64))
        return fail('unavailable', '合作档案原件校验失败，请重试')
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.toString('base64') !== base64 || bytes.byteLength !== file.fileSize)
        return fail('unavailable', '合作档案原件校验失败，请重试')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (payload.sha256 !== null && payload.sha256 !== sha256)
        return fail('unavailable', '合作档案原件校验失败，请重试')
      return { ...identity, state: 'available', payloadBase64: base64, sha256 }
    },
  }
}
