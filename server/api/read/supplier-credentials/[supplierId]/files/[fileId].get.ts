import { credentialProblem } from '../../../../../../app/lib/supplier/credential-contract'
import { productionSession, throwProductionStorageError } from '../../../../../utils/production-runtime'
import { productionSupplierRuntime } from '../../../../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../../../../utils/project-read-error'
import { supplierCredentialOrigin } from '../../../../../utils/supplier-credential-request'
import { supplierCredentialService, supplierCredentialSession } from '../../../../../utils/supplier-credential-runtime'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const query = getQuery(event)
    if (typeof query.credentialId !== 'string' || !query.credentialId.trim())
      throw credentialProblem('invalid-query', '原件请求缺少明确证照身份')
    const production = productionSupplierRuntime()
    if (production)
      return await production.suppliers.file({ supplierId: getRouterParam(event, 'supplierId') ?? '', credentialId: query.credentialId, fileId: getRouterParam(event, 'fileId') ?? '', origin: supplierCredentialOrigin(query, ['credentialId']) }, productionSession(event))
    return supplierCredentialService.file({ supplierId: getRouterParam(event, 'supplierId') ?? '', credentialId: query.credentialId, fileId: getRouterParam(event, 'fileId') ?? '', origin: supplierCredentialOrigin(query, ['credentialId']) }, supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
