import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionTargetCostService } from '../../server/utils/production-target-cost-service'

async function main() {
  const [directory, id, commandId, fileId, output] = process.argv.slice(2)
  if (!directory || !id || !commandId || !fileId || !output)
    throw new Error('cold budget probe requires explicit isolated paths and identities')
  const storage = createProductionStorage({ directory, workspaceId: 'budget-workspace', ownerId: 'budget-owner', purpose: 'verification' })
  const session = () => ({ workspaceId: 'budget-workspace', actorId: 'budget-owner', capabilities: ['target-cost:read', 'target-cost:write', 'project:list:read'] })
  const service = createProductionTargetCostService(storage)
  try {
    const read = await service.detail({ origin: 'real' }, id, session)
    const resolution = await service.resolve({ ...session(), commandId }, session)
    const file = (await service.file({ origin: 'real' }, id, fileId, session)).content
    await writeFile(output, JSON.stringify({ header: read.view.header, items: read.view.items, resolution, file }), 'utf8')
  }
  finally { await storage.close() }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
