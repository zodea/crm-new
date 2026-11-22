import { ownerCommercialDocumentReadTestInstance } from '../../../../utils/owner-commercial-document-read-test-instance'
import { productionOwnerDocumentRuntime } from '../../../../utils/production-owner-document-runtime'
import { throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionOwnerDocumentRuntime(event)
    if (production)
      return await production.detail(getRouterParam(event, 'kind') ?? '', getRouterParam(event, 'id') ?? '', getQuery(event))
    return ownerCommercialDocumentReadTestInstance.detail(
      getRouterParam(event, 'kind') ?? '',
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
