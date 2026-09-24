import { resolveBusinessSession } from '../../utils/business-session'

export default defineEventHandler((event) => {
  const session = resolveBusinessSession(event)
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...session.capabilities],
  }
})
