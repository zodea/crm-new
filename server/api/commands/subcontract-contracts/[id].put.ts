import { resolveBusinessSession } from '../../../utils/business-session'
import { throwProjectReadError } from '../../../utils/project-read-error'
import { parseSubcontractContractCommandRequest } from '../../../utils/subcontract-contract-command-request'
import { subcontractContractCommandTestInstance } from '../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id') ?? ''
    return await subcontractContractCommandTestInstance.execute(
      parseSubcontractContractCommandRequest(await readBody(event), { kind: 'update', routeId: id }),
      resolveBusinessSession(),
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
