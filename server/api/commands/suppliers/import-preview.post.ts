import { resolveBusinessSession } from '../../../utils/business-session'
import { demoWorkspaceTestInstance } from '../../../utils/demo-workspace-test-instance'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { productionSupplierRuntime } from '../../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseSupplierImportPreviewRequest } from '../../../utils/supplier-command-request'
import { supplierCommandTestInstance } from '../../../utils/supplier-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const production = productionSupplierRuntime()
    if (production)
      return await production.suppliers.previewImport(body, productionSession(event))
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const session = { ...resolveBusinessSession(), capabilities: demoWorkspaceTestInstance.capabilities(sessionId) }
    return { workspaceId: session.workspaceId, actorId: session.actorId, capabilities: [...session.capabilities], previews: supplierCommandTestInstance.previewImport(parseSupplierImportPreviewRequest(body), session, getHeader(event, 'x-ruihang-test-session')) }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
