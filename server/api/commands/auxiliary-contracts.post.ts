import { auxiliaryContractInstance, auxiliaryContractSession } from '../../utils/auxiliary-contract-runtime'
import { productionAuxiliaryContractRuntime } from '../../utils/production-auxiliary-contract-service'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  const key = getHeader(event, 'x-ruihang-test-session')
  try {
    const production = productionAuxiliaryContractRuntime()
    if (production)
      return await production.contracts.execute(await readBody(event), productionSession(event))
    return await auxiliaryContractInstance(key).execute(await readBody(event), auxiliaryContractSession(key))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
