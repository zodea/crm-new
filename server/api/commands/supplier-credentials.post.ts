import { throwProjectReadError } from '../../utils/project-read-error'
import { supplierCredentialOcrService } from '../../utils/supplier-credential-ocr-runtime'
import { parseSupplierCredentialCommand } from '../../utils/supplier-credential-request'
import { supplierCredentialService, supplierCredentialSession } from '../../utils/supplier-credential-runtime'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const command = parseSupplierCredentialCommand(await readBody(event))
    if (command.action === 'ocr-recognize')
      return await supplierCredentialOcrService.recognize(command, () => supplierCredentialSession(sessionId), sessionId)
    if (command.action === 'ocr-confirm')
      return supplierCredentialOcrService.confirm(command, supplierCredentialSession(sessionId), sessionId)
    return supplierCredentialService.execute(command, supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) { throwProjectReadError(cause) }
})
