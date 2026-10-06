import { materialContractProblem, MaterialContractRepositoryProblem } from '../../../../app/lib/material-contract/read-contract'
import { materialContractReadTestInstance } from '../../../utils/material-contract-read-test-instance'
import { productionMaterialContractRuntime } from '../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (typeof query.origin !== 'string' || !['real', 'demo'].includes(query.origin) || Object.keys(query).some(key => key !== 'origin'))
      throw new MaterialContractRepositoryProblem(materialContractProblem('validation-failed', '合同约定价必须指定一个有效来源'))
    const origin = query.origin as 'real' | 'demo'
    const production = productionMaterialContractRuntime()
    if (production)
      return await production.contracts.prices(origin, productionSession(event))
    return materialContractReadTestInstance.prices(origin, getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
