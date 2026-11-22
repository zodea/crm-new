import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createProductionOwnerDocumentMigration } from '../../server/utils/production-owner-document-migration'
import { createProductionOwnerDocumentService } from '../../server/utils/production-owner-document-service'
import { createProductionStorage } from '../../server/utils/production-storage'

async function main() {
  const [directory, actorText, descriptorText, output] = process.argv.slice(2)
  if (!directory || !actorText || !descriptorText || !output)
    throw new Error('cold import identity required')
  const actor = JSON.parse(actorText)
  const storage = createProductionStorage({ directory, workspaceId: actor.workspaceId, ownerId: actor.actorId, purpose: 'verification' })
  try {
    const migration = createProductionOwnerDocumentMigration(storage)
    const resolution = await migration.resolve(JSON.parse(descriptorText), () => actor)
    const state = await migration.state(() => actor)
    const original = await createProductionOwnerDocumentService(storage).file({ kind: 'acceptance', id: 'native-acceptance', fileId: 'native-blob', origin: 'real' }, () => actor)
    await writeFile(output, JSON.stringify({ resolution, state, original: { sha256: original.sha256, payloadBase64: Buffer.from(original.bytes).toString('base64') } }), 'utf8')
  }
  finally { await storage.close() }
}
void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
