import { throwProjectReadError } from '../../../../utils/project-read-error'
import { supplierCommandTestInstance } from '../../../../utils/supplier-command-test-instance'
import { supplierCredentialSession } from '../../../../utils/supplier-credential-runtime'
import { parseSupplierTaxpayerCommand } from '../../../../utils/supplier-taxpayer-request'
import { createSupplierTaxpayerService } from '../../../../utils/supplier-taxpayer-service'

const service = createSupplierTaxpayerService({ transact: supplierCommandTestInstance.transactCredentialScope })
export default defineEventHandler(async (event) => {
  try {
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return service.execute(parseSupplierTaxpayerCommand(await readBody(event), getRouterParam(event, 'id') ?? ''), supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) { throwProjectReadError(cause) }
})
