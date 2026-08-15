import { resolveBusinessSession } from '../../utils/business-session'

export default defineEventHandler(() => {
  const session = resolveBusinessSession()
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...session.capabilities],
  }
})
