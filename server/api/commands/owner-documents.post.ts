import { resolveBusinessSession } from '../../utils/business-session'
import { parseOwnerCommercialDocumentCommandRequest } from '../../utils/owner-commercial-document-command-request'
import { ownerCommercialDocumentCommandTestInstance } from '../../utils/owner-commercial-document-command-test-instance'
import { productionOwnerDocumentRuntime } from '../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const command = parseOwnerCommercialDocumentCommandRequest(await readBody(event))
    const production = productionOwnerDocumentRuntime(event)
    if (production)
      return await production.execute(command)
    return await ownerCommercialDocumentCommandTestInstance.execute(
      command,
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
