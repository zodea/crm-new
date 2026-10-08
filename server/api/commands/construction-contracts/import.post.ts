import { constructionFailure } from '../../../utils/production-construction-contract-record'
import { productionConstructionImportRuntime } from '../../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionConstructionImportRuntime()
    if (!formal)
      return constructionFailure('unavailable', '施工采用仅由正式磁盘owner接管')
    const body = await readBody(event)
    return getQuery(event).preflight === 'true' ? await formal.migration.preflight(body, productionSession(event)) : await formal.migration.adopt(body, productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
