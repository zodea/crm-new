import { productionSession, throwProductionStorageError } from '../../../../utils/production-runtime'
import { subcontractFailure } from '../../../../utils/production-subcontract-contract-record'
import { productionSubcontractImportRuntime } from '../../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionSubcontractImportRuntime()
    if (!formal)
      return subcontractFailure('unavailable', '分包原采用编号只能用真实持久证据核对')
    return await formal.migration.resolve(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
