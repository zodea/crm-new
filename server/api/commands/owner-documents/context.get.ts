import { resolveBusinessSession } from '../../../utils/business-session'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return ownerCommercialDocumentCommandTestInstance.context(
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
