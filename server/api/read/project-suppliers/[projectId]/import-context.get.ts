import { resolveBusinessSession } from '../../../../utils/business-session'
import { throwProjectReadError } from '../../../../utils/project-read-error'
import { projectReadTestInstance } from '../../../../utils/project-read-test-instance'
import { assertProjectSupplierWriteCapability } from '../../../../utils/project-supplier-command-request'
import { projectSupplierCommandTestInstance } from '../../../../utils/project-supplier-command-test-instance'
import { supplierReadTestInstance } from '../../../../utils/supplier-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const projectId = getRouterParam(event, 'projectId') ?? ''
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const session = resolveBusinessSession()
    assertProjectSupplierWriteCapability(session)
    const [project, suppliers] = await Promise.all([
      projectReadTestInstance.detail(projectId, { origin: 'real', includeDemo: 'false' }, sessionId),
      supplierReadTestInstance.formalOptions(sessionId),
    ])
    return {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      capabilities: [...session.capabilities],
      project: { id: project.item.project.id, name: project.item.project.label },
      suppliers,
      existingSupplierIds: project.projectSuppliers.items
        .flatMap(item => item.supplier.state === 'resolved' ? [item.supplier.id] : []),
      sourceVersion: projectSupplierCommandTestInstance.sourceVersion(sessionId),
    }
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
