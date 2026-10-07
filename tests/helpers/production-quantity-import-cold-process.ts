import process from 'node:process'
import { createProductionQuantityImport, readProductionQuantityImportedIdentities } from '../../server/utils/production-quantity-migration'
import { validateProductionQuantityState } from '../../server/utils/production-quantity-validation'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const storage = createProductionStorage({ directory: process.env.CRM_QUANTITY_COLD_DIRECTORY!, workspaceId: 'quantity-workspace', ownerId: 'quantity-owner', purpose: 'verification' })
  const actor = { workspaceId: 'quantity-workspace', actorId: 'quantity-owner', capabilities: ['quantity:read', 'quantity:write', 'worker:list:read', 'crew:list:read', 'worker:sensitive:read', 'project:list:read', 'core:migration:write'] }
  try {
    const sha = process.env.CRM_QUANTITY_IMPORT_SHA!
    const recovered = await createProductionQuantityImport(storage).resolve({ workspaceId: actor.workspaceId, actorId: actor.actorId, commandId: process.env.CRM_QUANTITY_IMPORT_COMMAND!, family: 'quantity-import', targetId: null, action: 'adopt', scopeId: sha }, () => actor)
    const identities = await storage.withTransaction(tx => readProductionQuantityImportedIdentities(tx, sha, actor))
    await storage.withTransaction(validateProductionQuantityState)
    process.stdout.write(JSON.stringify({ recovered, identities, valid: true }))
  }
  finally { await storage.close() }
}
void main().catch((error) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})
