import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { productionSupplierRuntime } from '../../utils/production-supplier-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'
import { supplierReadTestInstance } from '../../utils/supplier-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const production = productionSupplierRuntime()
    if (production)
      return await production.suppliers.list(getQuery(event), productionSession(event))
    return await supplierReadTestInstance.list(getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
