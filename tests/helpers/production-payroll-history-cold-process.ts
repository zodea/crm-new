import process from 'node:process'
import { createProductionPayrollImport } from '../../server/utils/production-payroll-import'
import { createProductionPayrollService } from '../../server/utils/production-payroll-service'
import { validateProductionPayrollState } from '../../server/utils/production-payroll-validation'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const actor = { workspaceId: 'history-workspace', actorId: 'history-owner', capabilities: ['payroll:read', 'payroll:write', 'quantity:read', 'worker:list:read', 'crew:list:read', 'project:list:read', 'core:migration:write', 'worker:sensitive:read'] }
  const storage = createProductionStorage({ directory: process.env.CRM_PAYROLL_HISTORY_DIRECTORY!, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  try {
    const recovered = await createProductionPayrollImport(storage).resolve(process.env.CRM_PAYROLL_HISTORY_COMMAND!, () => actor)
    if (recovered.outcome !== 'applied')
      throw new Error('未取得原工资来源可靠结果')
    const service = createProductionPayrollService(storage)
    const amounts = await Promise.all(recovered.result.statementIds.map(async id => (await service.forSession(() => actor).aOutput({ origin: 'real' }, id)).document?.actualAmount))
    const net = (await service.forSession(() => actor).actualLedger({ origin: 'real' }, { projectId: 'history-project' })).netAmount.value
    const directory = await service.workbook(() => actor).workbookArchive({ origin: 'real' }, { projectId: 'history-project', archiveId: process.env.CRM_PAYROLL_HISTORY_ARCHIVE! })
    await storage.withTransaction(validateProductionPayrollState)
    process.stdout.write(JSON.stringify({ recovered, amounts, net, numbers: directory.issues.map(row => row.number), valid: true }))
  }
  finally { await storage.close() }
}
main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
