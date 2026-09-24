import { ownerCommercialDocumentReadTestInstance } from '../../../utils/owner-commercial-document-read-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return ownerCommercialDocumentReadTestInstance.list(
      getRouterParam(event, 'kind') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
