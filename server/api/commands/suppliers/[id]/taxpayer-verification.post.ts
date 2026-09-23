import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { productionSupplierRuntime } from '../../../../utils/production-supplier-runtime'
import { productionSupplierId } from '../../../../utils/production-supplier-service'
import { throwProjectReadError } from '../../../../utils/project-read-error'
import { supplierCommandTestInstance } from '../../../../utils/supplier-command-test-instance'
import { supplierCredentialSession } from '../../../../utils/supplier-credential-runtime'
import { parseSupplierTaxpayerCommand } from '../../../../utils/supplier-taxpayer-request'
import { createSupplierTaxpayerService } from '../../../../utils/supplier-taxpayer-service'

const service = createSupplierTaxpayerService({ transact: supplierCommandTestInstance.transactCredentialScope })
export default defineEventHandler(async (event) => {
  try {
    const production = productionSupplierRuntime()
    if (production) {
      const body = await readBody(event)
      productionSupplierId(body?.commandId)
      return await production.suppliers.recordTaxpayer(parseSupplierTaxpayerCommand(body, getRouterParam(event, 'id') ?? ''), productionSession(event))
    }
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return service.execute(parseSupplierTaxpayerCommand(await readBody(event), getRouterParam(event, 'id') ?? ''), supplierCredentialSession(sessionId), sessionId)
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
