import { resolveBusinessSession } from '../../../utils/business-session'
import {
  MATERIAL_CONTRACT_FORM_PROJECTS,
  MATERIAL_CONTRACT_FORM_SUPPLIERS,
} from '../../../utils/material-contract-command-test-instance'

export default defineEventHandler(() => {
  const session = resolveBusinessSession()
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    capabilities: [...session.capabilities],
    projects: MATERIAL_CONTRACT_FORM_PROJECTS.map(row => ({ id: row.id, label: row.name })),
    suppliers: MATERIAL_CONTRACT_FORM_SUPPLIERS.map(row => ({ id: row.id, label: row.name })),
  }
})
