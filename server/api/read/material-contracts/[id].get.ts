import { materialContractReadTestInstance } from '../../../utils/material-contract-read-test-instance'
import { productionMaterialContractRuntime } from '../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionMaterialContractRuntime()
    if (production)
      return await production.contracts.detail(getRouterParam(event, 'id') ?? '', getQuery(event), productionSession(event))
    return materialContractReadTestInstance.detail(
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
