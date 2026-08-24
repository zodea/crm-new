import { resolveBusinessSession } from '../../../utils/business-session'
import {
  SUBCONTRACT_CONTRACT_FORM_PROJECTS,
  SUBCONTRACT_CONTRACT_FORM_SUPPLIERS,
} from '../../../utils/subcontract-contract-command-test-instance'

export default defineEventHandler(() => {
  const session = resolveBusinessSession()
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...session.capabilities],
    projects: SUBCONTRACT_CONTRACT_FORM_PROJECTS.map(row => ({ id: row.id, label: row.name })),
    suppliers: SUBCONTRACT_CONTRACT_FORM_SUPPLIERS.map(row => ({ id: row.id, label: row.name })),
  }
})
