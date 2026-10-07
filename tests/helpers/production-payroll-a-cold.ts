import process from 'node:process'
import { createProductionPayrollService } from '../../server/utils/production-payroll-service'
import { validateProductionPayrollState } from '../../server/utils/production-payroll-validation'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const input = JSON.parse(process.env.CRM_PAYROLL_A_COLD!)
  const storage = createProductionStorage(input.options)
  try {
    const owner = createProductionPayrollService(storage)
    const recovered = await owner.resolve(input.descriptor, () => input.actor)
    const service = owner.forSession(() => input.actor)
    const output = await service.aOutput({ origin: 'real' }, input.statementId)
    const ledger = await service.actualLedger({ origin: 'real' }, { projectId: input.projectId })
    await storage.withTransaction(validateProductionPayrollState)
    process.stdout.write(JSON.stringify({ recovered, output, netAmount: ledger.netAmount, statements: await storage.select('SELECT id,snapshot_json FROM wage_statements WHERE id=?', [input.statementId]) }))
  }
  finally { await storage.close() }
}
main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
