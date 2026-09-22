import type { PayrollAFeesFormRead } from '../../app/lib/payroll/central-a-fees-contract'
import { createHash } from 'node:crypto'
import { CORE_MIGRATION_CAPABILITY } from '../../app/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollAFeesFixture } from './payroll-a-fees-fixture'
import { readQuantityCoreSource } from './quantity-migration-source'

/** 两种 A 簿均经过原生公开核对发放，再走正式 source/preflight/import/confirm。 */
export async function createPayrollFeesMigrationFixture(options: { sameMonth?: boolean } = {}) {
  const original = await createPayrollAFeesFixture()
  try {
    await original.prices()
    await original.saveFees([original.fee()])
    const draft = { ...original.draft, book: original.ordinary, payRatio: 1 }
    const ordinary = await original.service.execute(original.command(await original.form(draft), { kind: 'save-a-draft', draft }))
    await original.release(ordinary.statementId!, 3730)
    const management = await original.management(options.sameMonth ? '2026-08' : '2026-09')
    const managed = await management.start()
    const read = await original.service.aForm({ origin: 'real' }, { statementId: managed.statementId! }) as PayrollAFeesFormRead
    const negativeScope = { assignments: management.scope.assignments.map(row => ({ ...row, cells: row.cells.filter(cell => cell.itemId === 'wall') })) }
    await original.service.executeFees(original.feeCommand(read, { kind: 'save-a-negative-lines', baseVersion: read.context.sourceVersion, lines: [{ lineId: null, baseRevisionId: null, label: '原负价清单', quantity: 10, unit: '㎡', unitPrice: -2, scope: negativeScope, reason: '管理清单原依据', evidenceNote: '按原责任十平方米核对', actualRef: null }], remove: [] }))
    await original.release(managed.statementId!, 284)
    const source = await readQuantityCoreSource(original.db)
    const bytes = original.db.raw.export()
    const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
    const session = resolveBusinessSession()
    const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
    await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('fees-preflight'), source, backup: null }), session)
    const batch = await coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('fees-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: new Date().toISOString(), immutable: true } }), session)
    if (batch.issues.some(issue => issue.metricKey === 'apply-failed'))
      throw new Error(JSON.stringify(batch.issues))
    await coreMigrationTestInstance.importBatch({ ...envelope('fees-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('fees-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'p')!.serverId
    const evidence = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<{ mapping_json: string, source_graph_json: string }>('SELECT * FROM payroll_migration_evidence WHERE project_id=?', [projectId]))[0]!)
    const mappings: Array<{ tableName: string, legacyId: string, centralId: string | null }> = JSON.parse(evidence.mapping_json)
    const mappedId = (table: string, legacyId: string): string => {
      const id = mappings.find(m => m.tableName === table && m.legacyId === legacyId)?.centralId
      if (!id)
        throw new Error(`缺少 ${table}/${legacyId} 映射`)
      return id
    }
    return { original, source, bytes, session, envelope, batch, projectId, evidence, mappings, mappedId, ordinaryId: mappedId('wage_statements', ordinary.statementId!), originalOrdinaryId: ordinary.statementId!, managedId: mappedId('wage_statements', managed.statementId!), originalManagedId: managed.statementId!, originalBook: management.book, service: payrollService, instance: quantityTestInstance }
  }
  catch (cause) {
    await original.close()
    throw cause
  }
}
