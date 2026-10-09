import { resolveBusinessSession } from '../../utils/business-session'
import { parseConstructionContractCommandRequest } from '../../utils/construction-contract-command-request'
import { constructionContractCommandTestInstance } from '../../utils/construction-contract-command-test-instance'
import { productionConstructionContractRuntime } from '../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../utils/production-runtime'
import { throwProjectReadError } from '../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionConstructionContractRuntime()
    if (formal)
      return await formal.contracts.execute(await readBody(event), productionSession(event))
    const session = resolveBusinessSession()
    const sessionId = getHeader(event, 'x-ruihang-test-session')
    return await constructionContractCommandTestInstance.execute(
      parseConstructionContractCommandRequest(await readBody(event), { kind: 'create' }),
      session,
      sessionId,
    )
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
