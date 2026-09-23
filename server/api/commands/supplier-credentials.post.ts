import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { productionSupplierRuntime } from '../../utils/production-supplier-runtime'
import { productionSupplierId } from '../../utils/production-supplier-service'
import { throwProjectReadError } from '../../utils/project-read-error'
import { recognizeSupplierCredential } from '../../utils/supplier-credential-ocr-provider'
import { supplierCredentialOcrService } from '../../utils/supplier-credential-ocr-runtime'
import { parseSupplierCredentialCommand } from '../../utils/supplier-credential-request'
import { supplierCredentialService, supplierCredentialSession } from '../../utils/supplier-credential-runtime'

export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    const body = await readBody(event)
    const production = productionSupplierRuntime()
    if (production)
      productionSupplierId(body?.commandId)
    const command = parseSupplierCredentialCommand(body)
    if (production) {
      if (command.action === 'ocr-recognize' || command.action === 'ocr-confirm')
        return await production.suppliers.executeOcr(command, productionSession(event), recognizeSupplierCredential)
      return await production.suppliers.executeCredential(command, productionSession(event))
    }
    if (command.action === 'ocr-recognize')
      return await supplierCredentialOcrService.recognize(command, () => supplierCredentialSession(sessionId), sessionId)
    if (command.action === 'ocr-confirm')
      return supplierCredentialOcrService.confirm(command, supplierCredentialSession(sessionId), sessionId)
    return supplierCredentialService.execute(command, supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
