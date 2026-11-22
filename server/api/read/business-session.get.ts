import { resolveBusinessSession } from '../../utils/business-session'
import { demoWorkspaceTestInstance } from '../../utils/demo-workspace-test-instance'
import { getProductionRuntimeConfig } from '../../utils/production-config'

export default defineEventHandler((event) => {
  const session = resolveBusinessSession(event)
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...(getProductionRuntimeConfig() ? session.capabilities : demoWorkspaceTestInstance.capabilities(getHeader(event, 'x-ruihang-test-session')))],
  }
})
