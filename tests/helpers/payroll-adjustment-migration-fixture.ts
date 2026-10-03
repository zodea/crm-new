import { createHash } from 'node:crypto'
import { CORE_MIGRATION_CAPABILITY } from '~/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAdjustmentFixture } from './payroll-adjustment-service-fixture'
import { readQuantityCoreSource } from './quantity-migration-source'

/** P4 全链原库由公开命令产生，SQLite 原字节及源 hash 随正常迁移预检传递。 */
export async function createPayrollAdjustmentMigrationFixture(options: { unrelatedProject?: boolean } = {}) {
  const original = await createPayrollAdjustmentFixture()
  try {
    const correction = await original.correct()
    const refund = await original.refund(correction.adjustment.id, 40)
    if (options.unrelatedProject) {
      const read = await original.service.c2Config({ origin: 'real' }, { projectId: 'other-project', leaderWorkerId: 'outside' })
      await original.service.executeC2(original.c2Command(read, { kind: 'save-c2-config', config: { crewId: 'crew', unitRate: 500, ruleText: '' } }))
    }
    const source = await readQuantityCoreSource(original.db)
    const bytes = original.db.raw.export()
    const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
    const session = resolveBusinessSession()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('p4-source-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('p4-source-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
    await coreMigrationTestInstance.importBatch({ ...envelope('p4-source-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('p4-source-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'p')!.serverId
    const evidence = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<{ mapping_json: string, source_graph_json: string }>('SELECT * FROM payroll_migration_evidence WHERE project_id=?', [projectId]))[0]!)
    const mappings: Array<{ tableName: string, legacyId: string, centralId: string | null }> = JSON.parse(evidence.mapping_json)
    const mappedId = (table: string, legacyId: string) => {
      const id = mappings.find(m => m.tableName === table && m.legacyId === legacyId)?.centralId
      if (!id)
        throw new Error(`原 ${table}/${legacyId} 缺少迁入身份`)
      return id
    }
    return { source, bytes, session, envelope, batch, projectId, originalStatementId: original.statementId, originalAdjustmentId: correction.adjustment.id, originalEventId: refund.actualEventId!, statementId: mappedId('wage_statements', original.statementId), adjustmentId: mappedId('payroll_adjustments', correction.adjustment.id), eventId: mappedId('payroll_actual_events', refund.actualEventId!), workerId: mappedId('workers', 'w'), mappedId, evidence, service: payrollService, instance: quantityTestInstance }
  }
  finally { await original.close() }
}
