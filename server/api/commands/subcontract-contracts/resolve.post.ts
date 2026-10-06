import { defineEventHandler, readBody } from 'h3'
import { resolveBusinessSession } from '../../../utils/business-session'
import { parseResolveCommandBody } from '../../../utils/command-journal'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { subcontractContractCommandTestInstance } from '../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const commandId = parseResolveCommandBody(await readBody(event))
    return subcontractContractCommandTestInstance.resolve(commandId, resolveBusinessSession(event))
  }
  catch (cause) { throwProjectReadError(cause) }
})
