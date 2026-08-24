import { resolveBusinessSession } from '../../../../utils/business-session'
import { constructionContractCommandTestInstance } from '../../../../utils/construction-contract-command-test-instance'
import { throwProjectReadError } from '../../../../utils/project-read-error'

export default defineEventHandler((event) => {
  try {
    const session = resolveBusinessSession()
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return constructionContractCommandTestInstance.form(
      getRouterParam(event, 'id') ?? '',
      session,
      sessionId,
    )
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
