import { resolveBusinessSession } from '../../../utils/business-session'
import { materialContractCommandTestInstance } from '../../../utils/material-contract-command-test-instance'

export default defineEventHandler((event) => {
  const session = resolveBusinessSession()
  if (!session.capabilities.includes('material-contract:write'))
    throw createError({ statusCode: 403, statusMessage: '无材料采购合同写入权限' })
  const sessionId = getHeader(event, 'x-ruihang-test-session')
  const context = materialContractCommandTestInstance.formContext(sessionId)
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...session.capabilities],
    projects: context.projects.map(row => ({ id: row.id, label: row.name })),
    suppliers: context.suppliers.map(row => ({ id: row.id, label: row.name, contactName: row.contact ?? '', contactPhone: row.contactPhone ?? '' })),
  }
})
