import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createProductionAuxiliaryContractService } from '../../server/utils/production-auxiliary-contract-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const [directory, id, kind, descriptorText, output] = process.argv.slice(2)
  if (!directory || !id || !kind || !descriptorText || !output)
    throw new Error('Auxiliary cold recovery requires an existing isolated source and minimal descriptor')
  const storage = createProductionStorage({ directory, workspaceId: 'subcontract-workspace', ownerId: 'subcontract-owner', purpose: 'verification' })
  const session = () => ({ workspaceId: 'subcontract-workspace', actorId: 'subcontract-owner', capabilities: ['auxiliary-contract:read', 'auxiliary-contract:write', 'auxiliary-contract:import', 'construction-contract:read', 'construction-scope:read', 'project:list:read', 'supplier:list:read', 'our-signatory:read', 'other-settlement:read'] })
  const service = createProductionAuxiliaryContractService(storage)
  try {
    const descriptor = JSON.parse(descriptorText)
    let resolution
    let resolutionProblem
    try {
      resolution = await service.resolve({ commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, action: descriptor.family === 'auxiliary-contract-import' ? descriptor.action : 'save', scopeId: descriptor.family === 'auxiliary-contract-import' ? descriptor.scopeId : descriptor.targetId ?? `new-${kind}` }, session)
    }
    catch (cause) {
      if (!(cause && typeof cause === 'object' && 'problem' in cause))
        throw cause
      resolutionProblem = cause.problem
    }
    const detail = await service.detail(id, { kind, origin: 'real' }, session)
    const files = []
    for (const file of detail.attachments)
      files.push(await service.file(id, file.id, session))
    const history = await storage.select('SELECT * FROM auxiliary_contract_versions WHERE id=? ORDER BY version', [id])
    const relation = await storage.select('SELECT * FROM construction_scope_history WHERE source_domain=\'auxiliary-contract\' AND source_id=? ORDER BY version', [id])
    const proof = await storage.select('SELECT evidence_json FROM auxiliary_contract_imports')
    await writeFile(output, JSON.stringify({ resolution, resolutionProblem, detail, files, history, relation, proof }), 'utf8')
  }
  finally { await storage.close() }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
