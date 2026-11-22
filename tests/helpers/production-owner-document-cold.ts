import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { OWNER_COMMERCIAL_DOCUMENT_KINDS } from '../../app/lib/owner-document/central-repository'
import { readProductionBoqChanges } from '../../server/utils/production-boq-record'
import { createProductionConstructionContractService } from '../../server/utils/production-construction-contract-service'
import { readProductionOwnerDocumentState } from '../../server/utils/production-owner-document-record'
import { createProductionOwnerDocumentService } from '../../server/utils/production-owner-document-service'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'
import { createProductionSubcontractContractService } from '../../server/utils/production-subcontract-contract-service'

async function main() {
  const [directory, actorText, locatorsText, output, hostsText] = process.argv.slice(2)
  if (!directory || !actorText || !locatorsText || !output)
    throw new Error('Business cold process needs the actual disk identity and original minimal locators')
  const actor = JSON.parse(actorText)
  const storage = createProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  const owner = createProductionOwnerDocumentService(storage)
  try {
    const resolutions = []
    for (const locator of JSON.parse(locatorsText))
      resolutions.push(await owner.resolve(locator.kind, locator.commandId, () => actor))
    const state = await storage.withTransaction(tx => readProductionOwnerDocumentState(tx, actor))
    const details = []
    const files = []
    const forms = []
    const views = []
    const lists = []
    const boqChanges = await storage.withTransaction(tx => readProductionBoqChanges(tx))
    for (const kind of OWNER_COMMERCIAL_DOCUMENT_KINDS)
      lists.push(await owner.list(kind, { origin: 'real' }, () => actor))
    for (const source of [...state.snapshot.documents, ...boqChanges]) {
      details.push(await owner.detail(source.kind, source.id, { origin: 'real' }, () => actor))
      forms.push(await owner.form(source.kind, source.id, () => actor))
      if (source.kind === 'acceptance') {
        for (const variant of ['acceptance', 'warranty'])
          views.push(await owner.detail('acceptance', source.id, { origin: 'real', variant }, () => actor))
      }
      for (const file of source.files.filter(file => file.deletedAt === null)) {
        if (state.metadataOnlyFileIds.has(file.id)) {
          files.push({ id: file.id, bodyState: 'metadata-only', metadata: file })
        }
        else {
          const original = await owner.file({ kind: source.kind, id: source.id, fileId: file.id, origin: 'real' }, () => actor)
          files.push({ id: file.id, sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') })
        }
      }
    }
    const hosts: { projects: unknown[], subcontracts: unknown[], constructionContracts: unknown[] } = { projects: [], subcontracts: [], constructionContracts: [] }
    if (hostsText) {
      const scopes = JSON.parse(hostsText) as { projectIds?: string[], subcontractIds?: string[], constructionIds?: string[] }
      for (const id of scopes.projectIds ?? [])
        hosts.projects.push(await createProductionProjectService(storage).detail(id, { origin: 'real' }, () => actor))
      for (const id of scopes.subcontractIds ?? [])
        hosts.subcontracts.push(await createProductionSubcontractContractService(storage).detail(id, { origin: 'real' }, () => actor))
      for (const id of scopes.constructionIds ?? [])
        hosts.constructionContracts.push(await createProductionConstructionContractService(storage).detail(id, { origin: 'real' }, () => actor))
    }
    await writeFile(output, JSON.stringify({ resolutions, details, forms, views, lists, files, hosts, allDocuments: state.allDocuments, allPenaltyDeductions: state.allPenaltyDeductions, allPenaltyRectifications: state.allPenaltyRectifications, boqChanges, deleted: [...state.deleted], history: await storage.select('SELECT * FROM owner_document_history ORDER BY id'), boqHistory: await storage.select('SELECT * FROM boq_history ORDER BY id'), snapshot: state.snapshot }), 'utf8')
  }
  finally { await storage.close() }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
