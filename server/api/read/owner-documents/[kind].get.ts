import { ownerCommercialDocumentReadTestInstance } from '../../../utils/owner-commercial-document-read-test-instance'
import { productionOwnerDocumentRuntime } from '../../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionOwnerDocumentRuntime(event)
    if (production)
      return await production.list(getRouterParam(event, 'kind') ?? '', getQuery(event))
    return ownerCommercialDocumentReadTestInstance.list(
      getRouterParam(event, 'kind') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
