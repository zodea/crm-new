import { resolveBusinessSession } from '../../../../utils/business-session'
import { materialContractCommandTestInstance } from '../../../../utils/material-contract-command-test-instance'
import { productionMaterialContractRuntime } from '../../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionMaterialContractRuntime()
    if (production)
      return await production.contracts.form(getRouterParam(event, 'id') ?? '', productionSession(event))
    return materialContractCommandTestInstance.form(
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
