import process from 'node:process'
import { validateProductionConstructionScopeState } from '../../server/utils/production-construction-scope-record'
import { createProductionConstructionScopeService } from '../../server/utils/production-construction-scope-service'
import { createProductionFinanceService } from '../../server/utils/production-finance-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const input = JSON.parse(process.env.CRM_CONSTRUCTION_SCOPE_COLD!)
  const storage = createProductionStorage(input.options)
  const actor = input.actor
  try {
    const service = createProductionConstructionScopeService(storage)
    const results = []
    for (const descriptor of input.descriptors)
      results.push(await service.resolve(descriptor, () => actor))
    const finance = []
    const financeService = createProductionFinanceService(storage)
    for (const original of input.finance ?? [])
      finance.push({ resolved: await financeService.resolve('reimbursement', original.commandId, () => actor), form: await financeService.form('reimbursement', original.id, () => actor) })
    await storage.withTransaction(validateProductionConstructionScopeState)
    process.stdout.write(JSON.stringify({ results, finance, links: await storage.select('SELECT * FROM construction_scope_links ORDER BY id'), history: await storage.select('SELECT * FROM construction_scope_history ORDER BY link_id,version') }))
  }
  finally { await storage.close() }
}
main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
