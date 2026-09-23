import { resolveBusinessSession } from '../../utils/business-session'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { productionSupplierRuntime } from '../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { parseSupplierCommandRequest } from '../../utils/supplier-command-request'
import { supplierCommandTestInstance } from '../../utils/supplier-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const production = productionSupplierRuntime()
    if (production)
      return await production.suppliers.execute(await readBody(event), productionSession(event))
    return await supplierCommandTestInstance.execute(
      parseSupplierCommandRequest(await readBody(event)),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
