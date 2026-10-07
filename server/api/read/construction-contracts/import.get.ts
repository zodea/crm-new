import { constructionFailure } from '../../../utils/production-construction-contract-record'
import { productionConstructionImportRuntime } from '../../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionConstructionImportRuntime()
    if (!formal)
      return constructionFailure('unavailable', '施工完整图采用仅由正式磁盘入口接管')
    return await formal.migration.state(productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
