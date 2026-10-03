import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { createBoqBuildingTestInstance } from '../../server/utils/boq-building-test-instance'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { createMemoryDb } from './memory-db'
import { seedWbsMigrationSource } from './wbs-migration-source'

export async function createBoqBuildingFixture() {
  const db = await createMemoryDb()
  const source = await seedWbsMigrationSource(db)
  let session = structuredClone(resolveBusinessSession())
  const owner = createOwnerCommercialDocumentCommandTestInstance()
  let core: ReturnType<typeof createCoreMigrationTestInstance>
  const quantity = createQuantityTestInstance({
    session: () => session,
    projects: () => core.snapshot(session).entities.filter(row => row.entityType === 'projects' && row.deletedAt === null).map(row => ({ id: row.id, name: row.name, code: '', dataOrigin: 'real' as const })),
    boq: projectId => owner.quantityBoqFacts(projectId),
  })
  core = createCoreMigrationTestInstance({ prepareTransition: snapshot => prepareCoreMigrationCommandSources(snapshot, [owner], [quantity]) })
  const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, commandId, requiredCapability: CORE_MIGRATION_CAPABILITY })
  await core.preflight({ ...envelope('boq-preflight'), source, backup: null }, session)
  const hash = 'd'.repeat(64)
  const batch = await core.dryRun({ ...envelope('boq-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 445, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }, session)
  await core.importBatch({ ...envelope('boq-import'), batchId: batch.batchId }, session)
  await core.confirm({ ...envelope('boq-confirm'), batchId: batch.batchId }, session)
  const query = { origin: 'real' as const, projectId: batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'q-project')!.serverId, contractId: batch.mappings.find(row => row.entityType === 'construction_contracts' && row.legacyId === 'q-contract')!.serverId }
  return {
    db,
    owner,
    quantity,
    core,
    source,
    batch,
    query,
    envelope,
    session,
    service: createBoqBuildingTestInstance(owner, quantity),
    setSession(next: typeof session) {
      session = next
    },
    async close() {
      await quantity.close()
      db.close()
    },
  }
}
