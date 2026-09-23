import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { productionSupplierRuntime } from '../../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { supplierCredentialOrigin } from '../../../utils/supplier-credential-request'
import { supplierCredentialService, supplierCredentialSession } from '../../../utils/supplier-credential-runtime'

export default defineEventHandler(async (event) => {
  try {
    const production = productionSupplierRuntime()
    if (production) {
      if (supplierCredentialOrigin(getQuery(event)) !== 'real')
        throw createError({ statusCode: 403, message: '正式证照不接受其他来源。' })
      return await production.suppliers.credentials(getRouterParam(event, 'supplierId') ?? '', productionSession(event))
    }
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return supplierCredentialService.read(getRouterParam(event, 'supplierId') ?? '', supplierCredentialOrigin(getQuery(event)), supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
