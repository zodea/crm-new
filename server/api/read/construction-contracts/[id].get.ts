import { constructionContractReadTestInstance } from '../../../utils/construction-contract-read-test-instance'
import { productionConstructionContractRuntime } from '../../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionConstructionContractRuntime()
    if (formal)
      return await formal.contracts.detail(getRouterParam(event, 'id') ?? '', getQuery(event), productionSession(event))
    return constructionContractReadTestInstance.detail(
      getRouterParam(event, 'id') ?? '',
      getQuery(event),
      getHeader(event, 'x-ruihang-test-session'),
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
