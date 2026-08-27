import { resolveBusinessSession } from '../../../utils/business-session'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { projectReadTestInstance } from '../../../utils/project-read-test-instance'
import { assertProjectSupplierWriteCapability, parseProjectSupplierImportCommandRequest } from '../../../utils/project-supplier-command-request'
import { projectSupplierCommandTestInstance } from '../../../utils/project-supplier-command-test-instance'
import { projectSupplierReadTestInstance } from '../../../utils/project-supplier-read-test-instance'
import { supplierReadTestInstance } from '../../../utils/supplier-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const request = parseProjectSupplierImportCommandRequest(await readBody(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const session = resolveBusinessSession()
    assertProjectSupplierWriteCapability(session)
    const [project, suppliers, existingRelationships] = await Promise.all([
      projectReadTestInstance.detail(request.projectId, { origin: 'real', includeDemo: 'false' }, sessionId),
      supplierReadTestInstance.formalOptions(sessionId),
      projectSupplierReadTestInstance.commandRelationships(request.projectId, 'real', sessionId),
    ])
    return await projectSupplierCommandTestInstance.execute(
      request,
      session,
      {
        project: { id: project.item.project.id, name: project.item.project.label },
        suppliers,
        existingRelationships: existingRelationships.flatMap(item => item.supplierId
          ? [{ relationId: item.relationId, supplierId: item.supplierId }]
          : []),
      },
      sessionId,
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
