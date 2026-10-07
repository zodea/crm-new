import { auxiliaryProblem } from '../../../../app/lib/auxiliary-contract/contract'
import { productionAuxiliaryContractRuntime } from '../../../utils/production-auxiliary-contract-service'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionAuxiliaryContractRuntime()
    if (!runtime)
      throw auxiliaryProblem('unavailable', '开发验证实例没有可靠持久原号，保留当前输入和编号')
    return await runtime.contracts.resolve(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
