import { readOurSignatories } from '../../../../app/lib/our-signatory/storage'
import { resolveBusinessSession } from '../../../utils/business-session'
import { materialContractCommandTestInstance } from '../../../utils/material-contract-command-test-instance'
import { developmentOurSignatoryOwner } from '../../../utils/our-signatory-runtime'
import { productionMaterialContractRuntime } from '../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionMaterialContractRuntime()
    if (production)
      return await production.contracts.context(productionSession(event))
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
      originalContracts: context.originalContracts,
      ourSignatories: session.capabilities.includes('our-signatory:read') ? await developmentOurSignatoryOwner(sessionId).withTransaction(async tx => (await readOurSignatories(tx)).records) : [],
    }
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
