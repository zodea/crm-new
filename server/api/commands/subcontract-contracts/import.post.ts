import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { subcontractFailure } from '../../../utils/production-subcontract-contract-record'
import { productionSubcontractImportRuntime } from '../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionSubcontractImportRuntime()
    if (!formal)
      return subcontractFailure('unavailable', '分包采用仅由正式磁盘owner接管')
    const body = await readBody(event)
    return getQuery(event).preflight === 'true' ? await formal.migration.preflight(body, productionSession(event)) : await formal.migration.adopt(body, productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
