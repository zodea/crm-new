import { resolveBusinessSession } from '../../../utils/business-session'
import { ownerCommercialDocumentCommandTestInstance } from '../../../utils/owner-commercial-document-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(() => {
  try {
    return ownerCommercialDocumentCommandTestInstance.context(resolveBusinessSession())
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
