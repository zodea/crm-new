import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { subcontractFailure } from '../../../utils/production-subcontract-contract-record'
import { productionSubcontractImportRuntime } from '../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionSubcontractImportRuntime()
    if (!formal)
      return subcontractFailure('unavailable', '分包整批恢复需真实磁盘证据')
    return await formal.migration.restore(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
