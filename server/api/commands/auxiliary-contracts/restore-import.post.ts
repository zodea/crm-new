import { auxiliaryProblem } from '../../../../app/lib/auxiliary-contract/contract'
import { productionAuxiliaryContractRuntime } from '../../../utils/production-auxiliary-contract-service'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionAuxiliaryContractRuntime()
    if (!runtime)
      throw auxiliaryProblem('unavailable', '辅助合同整批恢复需要正式持久owner')
    return await runtime.contracts.restore(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
