import { auxiliaryProblem } from '../../../../app/lib/auxiliary-contract/contract'
import { productionAuxiliaryContractRuntime } from '../../../utils/production-auxiliary-contract-service'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionAuxiliaryContractRuntime()
    if (!runtime)
      throw auxiliaryProblem('unavailable', '辅助合同正式采用来源尚不可读')
    return await runtime.contracts.importState(productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
