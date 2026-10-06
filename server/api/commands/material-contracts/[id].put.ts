import { resolveBusinessSession } from '../../../utils/business-session'
import { parseMaterialContractCommandRequest } from '../../../utils/material-contract-command-request'
import { materialContractCommandTestInstance } from '../../../utils/material-contract-command-test-instance'
import { productionMaterialContractRuntime } from '../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id') ?? ''
    const production = productionMaterialContractRuntime()
    if (production)
      return await production.contracts.execute(await readBody(event), productionSession(event), id)
    return await materialContractCommandTestInstance.execute(
      parseMaterialContractCommandRequest(await readBody(event), { kind: 'update', routeId: id }),
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
