import type { CoreMigrationSourceDTO } from '../../app/lib/migration/core-contract'
import type { PayrollProjectGraph } from '../../app/lib/migration/payroll-source'
import type { TestDb } from '../helpers/memory-db'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, coreMigrationSourceHashInput } from '../../app/lib/migration/core-contract'
import { parsePayrollProjectGraph, readPayrollProjectMigrationGraphs } from '../../app/lib/migration/payroll-source'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { payrollService } from '../../server/utils/payroll-runtime'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createPayrollNumberingFixture, numberingCommand } from '../helpers/payroll-numbering-fixture'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})
async function prepare(db: TestDb, source: CoreMigrationSourceDTO) {
  const bytes = db.raw.export()
  const snapshotSha256 = createHash('sha256').update(bytes).digest('hex')
  await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('number-preflight'), source, backup: null }), session)
  return coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('number-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${snapshotSha256}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256, byteLength: bytes.length, createdAt: new Date().toISOString(), immutable: true } }), session)
}
it('正式旧号和起点随完整原图迁入，原单再次出具不增号，日常回执阻挡危险恢复', async () => {
  const original = await createPayrollNumberingFixture()
  try {
    const beforeNumbering = (await readPayrollProjectMigrationGraphs(original.db)).find(row => row.legacyId === 'p')!
    const oldGraph = parsePayrollProjectGraph(JSON.parse(String(beforeNumbering.attributes!.payrollGraphJson)))
    expect(oldGraph.numbering).toBeUndefined()
    await original.initialize()
    const issued = await original.issue()
    const source = await readQuantityCoreSource(original.db)
    const graph = parsePayrollProjectGraph(JSON.parse(String(source.entities.payroll_projects!.find(row => row.legacyId === 'p')!.attributes!.payrollGraphJson)))
    expect(graph.schemaVersion).toBe(5)
    expect(graph.numbering!.tables.payroll_official_issues[0]).toMatchObject({ official_number: '128', statement_id: original.input.statementId, document_hash: issued.issue!.documentHash })
    expect(() => parsePayrollProjectGraph({ ...graph, schemaVersion: 4 })).toThrow()
    expect(parsePayrollProjectGraph(oldGraph)).toEqual(oldGraph)
    const batch = await prepare(original.db, source)
    expect(batch.issues.filter(row => row.metricKey === 'apply-failed')).toEqual([])
    await coreMigrationTestInstance.importBatch({ ...envelope('number-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('number-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'p')!.serverId
    const evidence = await quantityTestInstance.withWorkspaceTransaction(async tx => (await tx.select<{ mapping_json: string, source_graph_json: string }>('SELECT * FROM payroll_migration_evidence WHERE project_id=?', [projectId]))[0]!)
    const mappings: Array<{ tableName: string, legacyId: string, centralId: string }> = JSON.parse(evidence.mapping_json)
    const statementId = mappings.find(row => row.tableName === 'wage_statements' && row.legacyId === original.input.statementId)!.centralId
    const read = () => payrollService.numbering({ origin: 'real' }, { projectId, statementId })
    expect(await read()).toMatchObject({ settings: { firstNumber: 128, nextNumber: 129 }, issue: { number: '128', documentHash: issued.issue!.documentHash }, eligibility: { canDownload: true } })
    expect(JSON.parse(evidence.source_graph_json)).toEqual(graph)
    const before = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT * FROM payroll_official_issues'))
    const authority = coreMigrationTestInstance.snapshot(session)
    const repeated = await quantityTestInstance.prepareMigrationSnapshot(authority)
    await repeated.commit()
    expect(await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT * FROM payroll_official_issues'))).toEqual(before)
    const otherProjectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'other-project')!.serverId
    const other = await payrollService.numbering({ origin: 'real' }, { projectId: otherProjectId, statementId: null })
    await payrollService.executeNumbering(numberingCommand(other, 'unrelated-project-start', { kind: 'initialize', nextNumber: 9, evidenceNote: '另一项目旧号8' }))
    const unrelatedSafe = await quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(entity => entity.entityType !== 'payroll_projects') })
    await unrelatedSafe.abort()
    expect((await read()).issue?.number).toBe('128')
    await payrollService.executeNumbering(numberingCommand(await read(), 'post-migration-redownload', { kind: 'issue' }))
    expect((await read()).settings?.nextNumber).toBe(129)
    const receiptCount = await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT command_id FROM payroll_command_receipts'))
    await expect(quantityTestInstance.prepareMigrationSnapshot({ ...authority, entities: authority.entities.filter(entity => entity.entityType !== 'payroll_projects') })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(await quantityTestInstance.withWorkspaceTransaction(tx => tx.select('SELECT command_id FROM payroll_command_receipts'))).toEqual(receiptCount)
    expect((await read()).issue?.number).toBe('128')
  }
  finally { await original.close() }
}, 30_000)
it.each(['duplicate-old-number', 'missing-statement', 'bad-receipt', 'bad-number-hash'] as const)('迁入 %s 在删改前整批拒绝，不自动重新编号', async (kind) => {
  const original = await createPayrollNumberingFixture()
  try {
    await original.initialize()
    await original.issue()
    const source = await readQuantityCoreSource(original.db)
    const entity = source.entities.payroll_projects!.find(row => row.legacyId === 'p')!
    const graph: PayrollProjectGraph = JSON.parse(String(entity.attributes!.payrollGraphJson))
    const issue = graph.numbering!.tables.payroll_official_issues[0]!
    if (kind === 'duplicate-old-number')
      graph.numbering!.tables.payroll_official_issues.push({ ...issue, id: 'other-old-id', statement_id: 'another-original' })
    if (kind === 'missing-statement')
      issue.statement_id = 'missing-original'
    if (kind === 'bad-number-hash')
      issue.document_hash = 'f'.repeat(64)
    if (kind === 'bad-receipt')
      graph.central!.tables.payroll_command_receipts.find(row => row.action === 'numbering-issue')!.result_json = '{}'
    entity.attributes!.payrollGraphJson = JSON.stringify(graph)
    source.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(source)).digest('hex')
    let batch: Awaited<ReturnType<typeof prepare>> | undefined
    try {
      batch = await prepare(original.db, source)
    }
    catch (cause) {
      expect(String(cause)).toMatch(/编号|工资迁移|原图/)
    }
    if (batch) {
      if (batch.issues.some(row => row.metricKey === 'apply-failed')) {
        await expect(coreMigrationTestInstance.importBatch({ ...envelope('number-bad-import'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      }
      else {
        await coreMigrationTestInstance.importBatch({ ...envelope('number-bad-import'), batchId: batch.batchId }, session)
        await expect(coreMigrationTestInstance.confirm({ ...envelope('number-bad-confirm'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: expect.stringMatching(/conflict|unavailable/) } })
      }
    }
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
    expect((await original.read()).issue?.number).toBe('128')
  }
  finally { await original.close() }
}, 30_000)
