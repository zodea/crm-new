import type { ProjectSupplierFileQuery } from '../../app/lib/project-supplier/file-content'
import { parseProjectSupplierWorkbenchQuery, projectSupplierProblem, ProjectSupplierRepositoryProblem } from '../../app/lib/project-supplier/repository'
import { projectReadTestInstance } from './project-read-test-instance'
import { projectSupplierCommandTestInstance } from './project-supplier-command-test-instance'
import { createProjectSupplierFileReader } from './project-supplier-file-reader'
import { projectSupplierReadTestInstance } from './project-supplier-read-test-instance'
import { supplierReadTestInstance } from './supplier-read-test-instance'

export function parseProjectSupplierFileQuery(
  projectId: string,
  supplierId: string,
  fileId: string,
  input: Record<string, unknown>,
): ProjectSupplierFileQuery {
  const query = parseProjectSupplierWorkbenchQuery(projectId, supplierId, input)
  const { relationId, ownerType, ownerId } = input
  if (!fileId.trim() || typeof relationId !== 'string' || !relationId.trim()
    || typeof ownerType !== 'string' || !ownerType.trim()
    || typeof ownerId !== 'string' || !ownerId.trim()) {
    throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('invalid-query', '合作档案原件身份无效'))
  }
  return { ...query, fileId, relationId, ownerType, ownerId }
}

export const projectSupplierFileService = createProjectSupplierFileReader({
  async readAncestors(query, sessionId) {
    const input = { origin: query.origin, includeDemo: String(query.includeDemo) }
    const [project, supplier] = await Promise.all([
      projectReadTestInstance.detail(query.projectId, input, sessionId),
      supplierReadTestInstance.detail(query.supplierId, input, sessionId),
    ])
    if (project.item.project.id !== query.projectId || supplier.supplier.id !== query.supplierId
      || project.item.dataOrigin !== query.origin || supplier.dataOrigin !== query.origin) {
      throw new ProjectSupplierRepositoryProblem(projectSupplierProblem('relationship-mismatch', '当前项目或分供方与原件请求不匹配'))
    }
    return `${project.sourceVersion}:${supplier.sourceVersion}`
  },
  readWorkbench: (query, sessionId) => projectSupplierReadTestInstance.detail(query.projectId, query.supplierId, {
    origin: query.origin,
    includeDemo: String(query.includeDemo),
  }, sessionId),
  readPayload: (fileId, origin, sessionId) => projectSupplierCommandTestInstance.filePayload(fileId, origin, sessionId),
})
