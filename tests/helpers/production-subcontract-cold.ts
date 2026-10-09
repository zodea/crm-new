import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSubcontractMigration } from '../../server/utils/production-subcontract-contract-migration'
import { createProductionSubcontractContractService } from '../../server/utils/production-subcontract-contract-service'

async function main() {
  const [directory, id, descriptorText, output] = process.argv.slice(2)
  if (!directory || !id || !descriptorText || !output)
    throw new Error('Subcontract cold recovery requires existing isolated source and minimal descriptor')
  const storage = createProductionStorage({ directory, workspaceId: 'subcontract-workspace', ownerId: 'subcontract-owner', purpose: 'verification' })
  const session = () => ({ workspaceId: 'subcontract-workspace', actorId: 'subcontract-owner', capabilities: ['subcontract-contract:read', 'subcontract-contract:write', 'subcontract-contract:import', 'construction-contract:read', 'construction-scope:read', 'project:list:read', 'supplier:list:read', 'our-signatory:read'] })
  const service = createProductionSubcontractContractService(storage)
  const migration = createProductionSubcontractMigration(storage)
  try {
    const descriptor = JSON.parse(descriptorText)
    let resolution
    let resolutionProblem
    try {
      resolution = descriptor.family === 'subcontract-contract-import' ? await migration.resolve(descriptor, session) : await service.resolve(descriptor.commandId, session)
    }
    catch (cause) {
      if (!(cause && typeof cause === 'object' && 'problem' in cause))
        throw cause
      resolutionProblem = cause.problem
    }
    const form = await service.form(id, session)
    const detail = await service.detail(id, { origin: 'real' }, session)
    const files = []
    for (const file of form.attachments) {
      const original = await service.file(id, file.id, 'real', session)
      files.push({ id: file.id, sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') })
    }
    const history = await storage.select('SELECT * FROM subcontract_contract_versions WHERE id=? ORDER BY version', [id])
    const relation = await storage.select('SELECT * FROM construction_scope_history WHERE source_domain=\'subcontract-contract\' AND source_id=? ORDER BY version', [id])
    const proof = await storage.select('SELECT evidence_json FROM subcontract_contract_imports')
    await writeFile(output, JSON.stringify({ resolution, resolutionProblem, form, detail, files, history, relation, proof }), 'utf8')
  }
  finally { await storage.close() }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
