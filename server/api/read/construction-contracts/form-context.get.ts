import { resolveBusinessSession } from '../../../utils/business-session'
import { constructionContractCommandTestInstance } from '../../../utils/construction-contract-command-test-instance'

export default defineEventHandler((event) => {
  const session = resolveBusinessSession()
  const context = constructionContractCommandTestInstance.formContext(getHeader(event, 'x-ruihang-test-session'))
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...session.capabilities],
    projects: context.projects.map(row => ({ id: row.id, label: row.name, customerId: row.customerId })),
    customers: context.customers.map(row => ({ id: row.id, label: row.name })),
  }
})
