import { auxiliaryProblem } from '../../../../app/lib/auxiliary-contract/contract'
import { productionAuxiliaryContractRuntime } from '../../../utils/production-auxiliary-contract-service'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const runtime = productionAuxiliaryContractRuntime()
    if (!runtime)
      throw auxiliaryProblem('unavailable', '完整Native辅助合同采用只从已登记正式持久owner开放')
    const body: unknown = await readBody(event)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'mode,request' || !('mode' in body) || !('request' in body) || !['preflight', 'adopt'].includes(String(body.mode)))
      throw auxiliaryProblem('validation-failed', '辅助合同采用动作封套无效')
    return body.mode === 'preflight' ? await runtime.contracts.preflight(body.request, productionSession(event)) : await runtime.contracts.adopt(body.request, productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
