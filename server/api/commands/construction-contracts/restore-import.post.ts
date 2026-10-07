import { constructionFailure } from '../../../utils/production-construction-contract-record'
import { productionConstructionImportRuntime } from '../../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionConstructionImportRuntime()
    if (!formal)
      return constructionFailure('unavailable', '施工整批恢复需真实磁盘证据')
    return await formal.migration.restore(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
