import { resolveBusinessSession } from '../../../utils/business-session'
import { constructionContractReferences } from '../../../utils/construction-contract-references'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler((event) => {
  const session = resolveBusinessSession()
  try {
    return {
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      capabilities: [...session.capabilities],
      ...constructionContractReferences(getHeader(event, 'x-ruihang-test-session')),
    }
  }
  catch (cause) {
    throwProjectReadError(cause)
  }
})
