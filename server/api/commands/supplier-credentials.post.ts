import { throwProjectReadError } from '../../utils/project-read-error'
import { parseSupplierCredentialCommand } from '../../utils/supplier-credential-request'
import { supplierCredentialService, supplierCredentialSession } from '../../utils/supplier-credential-runtime'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return supplierCredentialService.execute(parseSupplierCredentialCommand(await readBody(event)), supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) { throwProjectReadError(cause) }
})
