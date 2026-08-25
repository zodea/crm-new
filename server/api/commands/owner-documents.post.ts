import { resolveBusinessSession } from '../../utils/business-session'
import { parseOwnerCommercialDocumentCommandRequest } from '../../utils/owner-commercial-document-command-request'
import { ownerCommercialDocumentCommandTestInstance } from '../../utils/owner-commercial-document-command-test-instance'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    return await ownerCommercialDocumentCommandTestInstance.execute(
      parseOwnerCommercialDocumentCommandRequest(await readBody(event)),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
