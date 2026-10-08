import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionWbsMigration } from '../../server/utils/production-wbs-migration'
import { createProductionWbsService } from '../../server/utils/production-wbs-service'

async function main() {
  const [directory, projectId, descriptorText, output] = process.argv.slice(2)
  if (!directory || !projectId || !descriptorText || !output)
    throw new Error('cold WBS requires explicit isolated paths and minimal original descriptor')
  const storage = createProductionStorage({ directory, workspaceId: 'wbs-workspace', ownerId: 'wbs-owner', purpose: 'verification' })
  const session = () => ({ workspaceId: 'wbs-workspace', actorId: 'wbs-owner', capabilities: ['schedule:read', 'schedule:write', 'schedule:import', 'quantity:read', 'process-library:read', 'project:list:read', 'construction-contract:read', 'boq:read', 'owner-document:read'] })
  const service = createProductionWbsService(storage)
  const migration = createProductionWbsMigration(storage)
  try {
    const descriptor = JSON.parse(descriptorText)
    const resolution = descriptor.family === 'schedule' ? await service.resolve(descriptor, session) : await migration.resolve(descriptor, session)
    const read = await service.read({ projectId, origin: 'real', includeDemo: false, today: '2026-09-12' }, '', session)
    const files = await migration.files(projectId, session)
    await writeFile(output, JSON.stringify({ resolution, read, files }), 'utf8')
  }
  finally { await storage.close() }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
