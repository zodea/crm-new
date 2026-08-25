import { ownerCommercialDocumentReadTestInstance } from '../../../../utils/owner-commercial-document-read-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    return ownerCommercialDocumentReadTestInstance.detail(
      getRouterParam(event, 'kind') ?? '',
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
