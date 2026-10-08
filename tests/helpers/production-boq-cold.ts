import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { createProductionBoqMigration } from '../../server/utils/production-boq-migration'
import { createProductionBoqService } from '../../server/utils/production-boq-service'
import { validateProductionBoqState } from '../../server/utils/production-boq-validation'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const [directory, identityText, scopeText, descriptorText, output] = process.argv.slice(2)
  if (!directory || !identityText || !scopeText || !descriptorText || !output)
    throw new Error('Boq cold process needs only actual disk identity, scope and original minimum locator')
  const actor = JSON.parse(identityText)
  const scope = JSON.parse(scopeText)
  const storage = createProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  try {
    const importer = createProductionBoqMigration(storage)
    const owner = createProductionBoqService(storage)
    const descriptor = JSON.parse(descriptorText)
    const resolution = descriptor.family === 'boq' ? await owner.resolve(descriptor, () => actor) : await importer.resolve(descriptor, () => actor)
    const workspace = await owner.read(scope, () => actor)
    const validation = await storage.withTransaction(tx => validateProductionBoqState(tx))
    const bodies = await storage.select<{ file_ref_id: string, content: Uint8Array, sha256: string }>('SELECT * FROM file_payloads ORDER BY file_ref_id')
    const bodyDirectory = `${output}.originals`
    await mkdir(bodyDirectory, { recursive: true })
    const originals = []
    for (const body of bodies) {
      const path = resolve(bodyDirectory, `${createHash('sha256').update(body.file_ref_id).digest('hex')}.bin`)
      await writeFile(path, body.content)
      originals.push({ fileRefId: body.file_ref_id, sha256: body.sha256, bytes: body.content.length, path })
    }
    const downloaded = []
    for (const file of workspace.files.filter(file => file.bodyState !== 'metadata-only')) {
      const original = await owner.file({ ...scope, ownerKind: 'boq-file', ownerId: file.id, fileId: file.fileRefId }, () => actor)
      downloaded.push({ ownerId: file.id, fileId: file.fileRefId, sha256: original.sha256, bytes: original.bytes.length })
    }
    for (const change of workspace.changes) {
      for (const file of change.document.files.filter(file => file.deletedAt === null && !validation.metadataOnlyFileIds.has(file.fileRefId ?? file.id))) {
        const original = await owner.file({ ...scope, ownerKind: 'owner-change', ownerId: change.id, fileId: file.id }, () => actor)
        downloaded.push({ ownerId: change.id, fileId: file.id, sha256: original.sha256, bytes: original.bytes.length })
      }
    }
    await writeFile(output, JSON.stringify({ resolution, workspace, metadataOnlyFileIds: [...validation.metadataOnlyFileIds], originals, downloaded }), 'utf8')
  }
  finally { await storage.close() }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
