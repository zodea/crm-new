import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { materialContractCommandTestInstance } from '../../../utils/material-contract-command-test-instance'
import { productionMaterialContractRuntime } from '../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const commandId = parseResolveCommandBody(await readBody(event))
    const production = productionMaterialContractRuntime()
    if (production)
      return await production.contracts.resolve(commandId, productionSession(event))
    return materialContractCommandTestInstance.resolve(
      commandId,
      resolveBusinessSession(),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
