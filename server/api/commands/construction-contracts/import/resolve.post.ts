import { constructionFailure } from '../../../../utils/production-construction-contract-record'
import { productionConstructionImportRuntime } from '../../../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionConstructionImportRuntime()
    if (!formal)
      return constructionFailure('unavailable', '施工原采用编号只能用真实持久证据核对')
    return await formal.migration.resolve(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
