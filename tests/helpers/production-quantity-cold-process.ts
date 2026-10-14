import process from 'node:process'
import { createProductionQuantityService, quantityRecoveryDescriptor } from '../../server/utils/production-quantity-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { parseQuantityCommand } from '../../server/utils/quantity-request'

async function main() {
  const storage = createProductionStorage({ directory: process.env.CRM_QUANTITY_COLD_DIRECTORY!, workspaceId: 'quantity-workspace', ownerId: 'quantity-owner', purpose: 'verification' })
  const actor = { workspaceId: 'quantity-workspace', actorId: 'quantity-owner', capabilities: ['quantity:read', 'quantity:write', 'worker:list:read', 'crew:list:read', 'project:list:read'] }
  try {
    const owner = createProductionQuantityService(storage)
    const locator = JSON.parse(process.env.CRM_QUANTITY_COLD_DESCRIPTOR!)
    const descriptor = await storage.withTransaction(async (tx) => {
      const [intent] = await tx.select<{ request_json: string }>('SELECT request_json FROM quantity_command_intents WHERE workspace_id=? AND actor_id=? AND command_id=?', [locator.workspaceId, locator.actorId, locator.commandId])
      if (!intent)
        throw new Error('原量域请求证据缺失')
      return quantityRecoveryDescriptor(parseQuantityCommand(JSON.parse(intent.request_json)))
    })
    const recovered = await owner.resolve(descriptor, () => actor)
    const read = await owner.forSession(() => actor).region({ projectId: 'quantity-project', origin: 'real', includeDemo: false })
    process.stdout.write(JSON.stringify({ recovered, buildings: read.data.buildings }))
  }
  finally { await storage.close() }
}
void main().catch((error) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})
