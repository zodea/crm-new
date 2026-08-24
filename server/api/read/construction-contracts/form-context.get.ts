import { resolveBusinessSession } from '../../../utils/business-session'
import {
  CONSTRUCTION_CONTRACT_FORM_CUSTOMERS,
  CONSTRUCTION_CONTRACT_FORM_PROJECTS,
} from '../../../utils/construction-contract-command-test-instance'

export default defineEventHandler(() => {
  const session = resolveBusinessSession()
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...session.capabilities],
    projects: CONSTRUCTION_CONTRACT_FORM_PROJECTS.map(row => ({ id: row.id, label: row.name, customerId: row.customerId })),
    customers: CONSTRUCTION_CONTRACT_FORM_CUSTOMERS.map(row => ({ id: row.id, label: row.name })),
  }
})
