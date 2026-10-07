import { resolveBusinessSession } from '../../../utils/business-session'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { productionSubcontractContractRuntime } from '../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { subcontractContractCommandTestInstance } from '../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionSubcontractContractRuntime()
    if (formal)
      return await formal.contracts.context(productionSession(event))
    return subcontractContractCommandTestInstance.context(resolveBusinessSession(), getHeader(event, 'x-ruihang-test-session'))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
