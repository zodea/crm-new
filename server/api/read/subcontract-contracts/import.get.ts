import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { subcontractFailure } from '../../../utils/production-subcontract-contract-record'
import { productionSubcontractImportRuntime } from '../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionSubcontractImportRuntime()
    if (!formal)
      return subcontractFailure('unavailable', '分包完整图采用仅由正式磁盘入口接管')
    return await formal.migration.state(productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
