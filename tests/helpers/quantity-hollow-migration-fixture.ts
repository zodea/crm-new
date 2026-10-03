import type { CoreMigrationServerEntityDTO } from '../../app/lib/migration/core-contract'
import type { QuantityCommand } from '../../app/lib/quantity/central-contract'
import type { QuantityHollowAction, QuantityHollowRead } from '../../app/lib/quantity/central-hollow-contract'
import type { TestDb } from './memory-db'
import { createHash } from 'node:crypto'
import initSqlJs from 'sql.js'
import { blankQuantityTemplateDraft } from '../../app/lib/quantity/template'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { prepareCoreMigrationCommandSources } from '../../server/utils/core-migration-preparation'
import { createCoreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { loadQuantityHollowMigratedProof } from '../../server/utils/quantity-hollow-migrated-proof'
import { createQuantityHollowService } from '../../server/utils/quantity-hollow-service'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { readQuantityCoreSource } from './quantity-migration-source'

export async function cloneQuantityHollowSnapshot(bytes: Uint8Array): Promise<TestDb> {
  const SQL = await initSqlJs()
  const raw = new SQL.Database(bytes)
  raw.run('PRAGMA foreign_keys=ON')
  return {
    raw,
    async execute(sql, params = []) { raw.run(sql, params as never[]) },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const statement = raw.prepare(sql)
      try {
        statement.bind(params as never[])
        const rows: T[] = []
        while (statement.step()) rows.push(statement.getAsObject() as T)
        return rows
      }
      finally { statement.free() }
    },
    close() { raw.close() },
  }
}

/** 来源来自完整真实 SQLite；目标由公开 preflight/dryRun/import/confirm 驱动正式数量 prepare。 */
export async function importQuantityHollowFixture(native: TestDb) {
  const [sourceContext] = await native.select<{ workspace_id: string, actor_id: string }>('SELECT workspace_id,actor_id FROM quantity_hollow_command_receipts ORDER BY id LIMIT 1')
  const session = { ...resolveBusinessSession(), workspaceId: sourceContext!.workspace_id, actorId: sourceContext!.actor_id }
  let published: CoreMigrationServerEntityDTO[] = []
  const nativeProjects: Array<{ id: string, name: string, code: string, dataOrigin: 'real' }> = []
  const nativePeople: Array<{ id: string, name: string, kind: 'worker', trade: string, trades: string[], itemNames: string[], dataOrigin: 'real' }> = []
  const projects = () => [...published.filter(row => row.entityType === 'projects').map(row => ({ id: row.id, name: row.name, code: String(row.attributes.code ?? ''), dataOrigin: 'real' as const })), ...nativeProjects]
  const people = () => [...published.filter(row => row.entityType === 'workers' || row.entityType === 'crews').map(row => ({ id: row.id, name: row.name, kind: row.entityType === 'workers' ? 'worker' as const : 'crew' as const, trade: String(row.attributes.trade ?? '泥水工'), trades: ['泥水工'], itemNames: [], dataOrigin: 'real' as const })), ...nativePeople]
  const instance = createQuantityTestInstance({ session: () => session, projects, people })
  const core = createCoreMigrationTestInstance({ prepareTransition: snapshot => prepareCoreMigrationCommandSources(snapshot, [{ prepareMigrationSnapshot: () => () => {
    published = structuredClone(snapshot.entities)
  } }], [instance]) })
  const serviceOptions = { session: () => session, projects, people, migratedProof: loadQuantityHollowMigratedProof, transaction: <T>(work: Parameters<typeof instance.withWorkspaceTransaction<T>>[0]) => instance.withWorkspaceTransaction(work) }
  const service = createQuantityHollowService(serviceOptions)
  let sequence = 0
  const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'core:migration:write' as const, commandId })
  try {
    const source = await readQuantityCoreSource(native)
    const bytes = native.raw.export()
    await native.execute('PRAGMA foreign_keys=ON')
    const hash = createHash('sha256').update(bytes).digest('hex')
    await core.preflight({ ...envelope('hollow-preflight'), source, backup: null }, session)
    const batch = await core.dryRun({ ...envelope('hollow-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }, session)
    await core.importBatch({ ...envelope('hollow-import'), batchId: batch.batchId }, session)
    await core.confirm({ ...envelope('hollow-confirm'), batchId: batch.batchId }, session)
    const projectId = projects()[0]!.id
    const [root] = await instance.withWorkspaceTransaction(tx => tx.select<{ id: string, unit_id: string }>('SELECT id,unit_id FROM quantity_hollow_records WHERE project_id=?', [projectId]))
    if (!root)
      throw new Error('公开迁入未保留检查根')
    const scope = { projectId, unitId: root.unit_id, origin: 'real' as const, includeDemo: false }
    const command = (read: QuantityHollowRead, action: QuantityHollowAction) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'quantity:write' as const, commandId: `central-hollow-${++sequence}`, baseVersion: read.sourceVersion, origin: 'real' as const, projectId, action })
    const rollback = () => core.rollback({ ...envelope(`hollow-rollback-${++sequence}`), batchId: batch.batchId }, session)
    async function createIndependent(related: boolean) {
      const independentProject = { id: 'independent-hollow-project', name: '独立原生检查项目', code: 'IH', dataOrigin: 'real' as const }
      nativeProjects.push(independentProject)
      const workerId = related ? people().find(row => row.kind === 'worker')!.id : 'independent-hollow-worker'
      if (!related)
        nativePeople.push({ id: workerId, name: '独立原生工人', kind: 'worker', trade: '泥水工', trades: ['泥水工'], itemNames: [], dataOrigin: 'real' })
      const query = { projectId: independentProject.id, origin: 'real' as const, includeDemo: false }
      async function execute(action: QuantityCommand['action']) {
        const read = await instance.region(query)
        return instance.execute({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: 'quantity:write', commandId: `independent-quantity-${++sequence}`, baseVersion: read.sourceVersion, projectId: query.projectId, origin: 'real', action })
      }
      const draft = blankQuantityTemplateDraft(query.projectId)
      draft.code = 'IH'
      draft.name = '独立户型'
      draft.newItems = [{ key: 'independent-wall', code: 'IW', name: '独立墙砖', section: '', trade: '泥水工', unit: '㎡', sortOrder: 1 }]
      draft.lines = [{ key: 'independent-line', id: null, roomKey: draft.rooms[0]!.key, itemId: 'independent-wall', recognizedContractQty: null, contractQty: null, provisionalQty: null, fieldFormula: '2*3', fieldQty: 6, note: '', sortOrder: 1 }]
      const template = await execute({ kind: 'save-template', draft })
      const building = await execute({ kind: 'create-building', draft: { code: 'IB', name: '独立栋' } })
      const floor = await execute({ kind: 'create-floor', buildingId: building.id, draft: { code: 'IF', name: '独立层' } })
      const unit = await execute({ kind: 'create-unit', floorId: floor.id, draft: { code: 'I101', name: '独立户', templateId: template.id } })
      const cell = (await instance.assignments(query)).data.scopeOptions[0]!
      await execute({ kind: 'save-assignments', draft: { projectId: query.projectId, trade: '泥水工', assigneeKind: 'worker', assigneeId: workerId, unitIds: [unit.id], expectedAssignments: [{ unitId: unit.id, assignmentId: null, fingerprint: null }], scopes: [{ unitId: unit.id, roomId: cell.roomId, itemId: cell.itemId }], note: '', allowReplacement: false } })
      const independentScope = { ...query, unitId: unit.id }
      const read = await service.hollow(independentScope)
      await service.executeHollow({ ...command(read, { kind: 'create-hollow-inspection', target: read.data.targets[0]!.target, input: { inspectedOn: '2026-09-15', count: 0, note: '独立项目明确检查零处' } }), projectId: query.projectId })
      return { scope: independentScope, read: await service.hollow(independentScope) }
    }
    return { instance, core, source, batch, session, envelope, service, reload: () => createQuantityHollowService(serviceOptions), scope, recordId: root.id, command, rollback, createIndependent, close: () => instance.close() }
  }
  catch (cause) {
    await instance.close()
    throw cause
  }
}
