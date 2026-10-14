import process from 'node:process'
import { createProductionCrewWorkerService } from '../../server/utils/production-crew-worker-service'
import { createProductionPayrollService } from '../../server/utils/production-payroll-service'
import { validateProductionPayrollState } from '../../server/utils/production-payroll-validation'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const descriptor = JSON.parse(process.env.CRM_PAYROLL_COLD_DESCRIPTOR!)
  const storage = createProductionStorage({ directory: process.env.CRM_PAYROLL_COLD_DIRECTORY!, workspaceId: descriptor.workspaceId, ownerId: descriptor.actorId, purpose: 'verification' })
  const actor = { workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, capabilities: ['payroll:read', 'payroll:write', 'worker:list:read', 'crew:list:read', 'project:list:read', 'worker:sensitive:read'] }
  try {
    const owner = createProductionPayrollService(storage)
    const recovered = await owner.resolve(descriptor, () => actor)
    const result = recovered.outcome === 'applied' ? recovered.result as { statementId: string } : null
    const chainInput = process.env.CRM_PAYROLL_COLD_CHAIN ? JSON.parse(process.env.CRM_PAYROLL_COLD_CHAIN) : null
    const service = owner.forSession(() => actor)
    const output = result?.statementId ? await service.c1Output({ origin: 'real' }, result.statementId) : null
    let chain = null
    if (chainInput) {
      await storage.withTransaction(db => validateProductionPayrollState(db))
      chain = { netAmount: (await service.actualLedger({ origin: 'real' }, { projectId: chainInput.projectId })).netAmount.value, statement: (await service.c2Output({ origin: 'real' }, chainInput.statementId)).document, plan: await service.batch({ origin: 'real' }, chainInput.planId), directory: await owner.workbook(() => actor).workbookArchive({ origin: 'real' }, { projectId: chainInput.projectId, archiveId: chainInput.archiveId }), roster: await createProductionCrewWorkerService(storage).rosterArchive(chainInput.projectId, chainInput.rosterId, () => actor) }
    }
    process.stdout.write(JSON.stringify({ recovered, output, ...(chainInput ? { chain } : {}) }))
  }
  finally { await storage.close() }
}
main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
