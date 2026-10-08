import { resolveBusinessSession } from '../../../utils/business-session'
import { constructionContractReferences } from '../../../utils/construction-contract-references'
import { productionConstructionContractRuntime } from '../../../utils/production-construction-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const formal = productionConstructionContractRuntime()
    if (formal)
      return await formal.contracts.context(productionSession(event))
    const session = resolveBusinessSession()
    return {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      capabilities: [...session.capabilities],
      ...constructionContractReferences(getHeader(event, 'x-ruihang-test-session')),
    }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
