import { resolveBusinessSession } from '../../../../utils/business-session'
import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { productionSupplierRuntime } from '../../../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'
import { supplierCommandTestInstance } from '../../../../utils/supplier-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const production = productionSupplierRuntime()
    if (production)
      return await production.suppliers.form(getRouterParam(event, 'id') ?? '', productionSession(event))
    return supplierCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
