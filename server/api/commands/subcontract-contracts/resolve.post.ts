import { defineEventHandler, readBody } from 'h3'
import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { productionSubcontractContractRuntime } from '../../../utils/production-subcontract-contract-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { subcontractContractCommandTestInstance } from '../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const commandId = parseResolveCommandBody(await readBody(event))
    const formal = productionSubcontractContractRuntime()
    if (formal)
      return await formal.contracts.resolve(commandId, productionSession(event))
    return subcontractContractCommandTestInstance.resolve(commandId, resolveBusinessSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
