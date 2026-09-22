import { throwProjectReadError } from '../../../utils/project-read-error'
import { supplierCredentialOrigin } from '../../../utils/supplier-credential-request'
import { supplierCredentialService, supplierCredentialSession } from '../../../utils/supplier-credential-runtime'

export default defineEventHandler((event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return supplierCredentialService.read(getRouterParam(event, 'supplierId') ?? '', supplierCredentialOrigin(getQuery(event)), supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) { throwProjectReadError(cause) }
})
