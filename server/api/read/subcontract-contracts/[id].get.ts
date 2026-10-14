import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { productionSubcontractContractRuntime } from '../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { subcontractContractReadTestInstance } from '../../../utils/subcontract-contract-read-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionSubcontractContractRuntime()
    if (formal)
      return await formal.contracts.detail(getRouterParam(event, 'id') ?? '', getQuery(event), productionSession(event))
    return subcontractContractReadTestInstance.detail(getRouterParam(event, 'id') ?? '', getQuery(event), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
