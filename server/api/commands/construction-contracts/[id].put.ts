import { resolveBusinessSession } from '../../../utils/business-session'
import { parseConstructionContractCommandRequest } from '../../../utils/construction-contract-command-request'
import { constructionContractCommandTestInstance } from '../../../utils/construction-contract-command-test-instance'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const id = getRouterParam(event, 'id') ?? ''
    const session = resolveBusinessSession()
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return await constructionContractCommandTestInstance.execute(
      parseConstructionContractCommandRequest(await readBody(event), { kind: 'update', routeId: id }),
      session,
      sessionId,
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
