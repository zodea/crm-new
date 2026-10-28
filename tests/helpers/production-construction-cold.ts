import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createProductionConstructionMigration } from '../../server/utils/production-construction-contract-migration'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const [directory, contractId, descriptorText, output] = process.argv.slice(2)
  if (!directory || !contractId || !descriptorText || !output)
    throw new Error('construction cold process requires isolated paths and original minimal descriptor')
  const storage = createProductionStorage({ directory, workspaceId: 'construction-workspace', ownerId: 'construction-owner', purpose: 'verification' })
  const session = () => ({ workspaceId: 'construction-workspace', actorId: 'construction-owner', capabilities: ['construction-contract:read', 'construction-contract:write', 'construction-contract:import', 'project:list:read', 'customer:list:read', 'our-signatory:read'] })
  const owner = createProductionConstructionContractService(storage)
  const migration = createProductionConstructionMigration(storage)
  try {
    const descriptor = JSON.parse(descriptorText)
    let resolution
    let resolutionProblem
    try {
      resolution = descriptor.family === 'construction-contract-import' ? await migration.resolve(descriptor, session) : await owner.resolve(descriptor.commandId, session)
    }
    catch (cause) {
      if (!(cause && typeof cause === 'object' && 'problem' in cause))
        throw cause
      resolutionProblem = cause.problem
    }
    const detail = await owner.detail(contractId, { origin: 'real' }, session)
    const form = await owner.form(contractId, session)
    const files = []
    for (const file of form.attachments) {
      const original = await owner.file(contractId, file.id, 'real', session)
      files.push({ id: file.id, sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') })
    }
    await writeFile(output, JSON.stringify({ resolution, resolutionProblem, detail, form, files }), 'utf8')
  }
  finally {
    await storage.close()
  }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
