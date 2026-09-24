import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { readQuantityCoreSource, seedQuantityMigrationSource } from '../helpers/quantity-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })

async function dryRun(source: CoreMigrationSourceDTO) {
  const preflight = parseCoreMigrationSourceCommand({ ...envelope('quantity-preflight'), source, backup: null })
  expect(preflight.source).toEqual(source)
  await coreMigrationTestInstance.preflight(preflight, session)
  const hash = 'e'.repeat(64)
  return coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('quantity-dry'), source, backup: {
    backupId: `core-migration-${source.sourceHash}-${hash}`,
    sourceHash: source.sourceHash,
    sourceVersion: source.sourceVersion,
    snapshotSha256: hash,
    byteLength: 442,
    createdAt: new Date().toISOString(),
    immutable: true,
  } }), session)
}

afterEach(async () => {
  await coreMigrationTestInstance.reset(session.workspaceId)
  await quantityTestInstance.reset()
})

it('历史照片缺正文只登记明确提示，元数据照实迁入且读正文报告缺失', async () => {
  const db = await createMemoryDb()
  try {
    await seedQuantityMigrationSource(db)
    await db.execute('DELETE FROM file_payloads WHERE file_ref_id = ?', ['q-photo'])
    const source = await readQuantityCoreSource(db)
    const batch = await dryRun(source)
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'quantity_projects', metricKey: 'missing-original', actualValue: 1 }))
    await coreMigrationTestInstance.importBatch({ ...envelope('missing-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('missing-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    const namespace = batch.mappings.find(row => row.entityType === 'quantity_projects')!.serverId
    const unitId = `${namespace}:units:q-unit`
    const query = { projectId, origin: 'real' as const, includeDemo: false, unitId }
    const detail = await quantityTestInstance.completion(query)
    expect(detail.data.stages[0]!.photos).toContainEqual(expect.objectContaining({ id: `${namespace}:file_refs:q-photo`, fileName: '验收.png' }))
    await expect(quantityTestInstance.photo({ ...query, completionId: `${namespace}:unit_stage_completions:q-done`, photoId: `${namespace}:file_refs:q-photo` })).rejects.toMatchObject({ problem: { code: 'not-found' } })
  }
  finally { db.close() }
})

it('真实十五表来源经解析、确认进入中央读写，三量空零与照片保留，更正不被重复同步覆盖', async () => {
  const db = await createMemoryDb()
  try {
    const source = await seedQuantityMigrationSource(db)
    const batch = await dryRun(source)
    expect(batch.issues.filter(issue => issue.metricKey === 'apply-failed' || issue.metricKey === 'missing-relation')).toEqual([])
    await coreMigrationTestInstance.importBatch({ ...envelope('quantity-import'), batchId: batch.batchId }, session)
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
    await coreMigrationTestInstance.confirm({ ...envelope('quantity-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects' && row.legacyId === 'q-project')!.serverId
    const namespace = batch.mappings.find(row => row.entityType === 'quantity_projects')!.serverId
    const id = (table: string, old: string) => `${namespace}:${table}:${old}`
    const query = { projectId, origin: 'real' as const, includeDemo: false }
    const region = await quantityTestInstance.region(query)
    expect(region.data.buildings.map(row => row.id)).toEqual([id('buildings', 'q-building')])
    const templates = await quantityTestInstance.templates(query)
    expect(templates.data.lines).toEqual([expect.objectContaining({ boqLineId: 'q-boq', recognizedContractQty: 8, contractQty: 0, provisionalQty: 6, fieldQty: null })])
    const unitId = id('units', 'q-unit')
    const detail = await quantityTestInstance.completion({ ...query, unitId })
    const stage = detail.data.stages[0]!
    expect(stage.completion).toMatchObject({ id: id('unit_stage_completions', 'q-done'), status: 'completed', note: '旧库备注' })
    const content = await quantityTestInstance.photo({ ...query, unitId, completionId: stage.completion!.id, photoId: id('file_refs', 'q-photo') })
    expect(content.data.contentBase64).toBe('AQID')
    const save = await quantityTestInstance.execute({ ...session, origin: 'real', projectId, requiredCapability: 'quantity:write', commandId: 'quantity-correction', baseVersion: detail.sourceVersion, action: { kind: 'save-completion', draft: { projectId, unitId, stageId: stage.id, status: 'completed', completedAt: '2026-09-11', note: '中央更正', expectedCompletionId: stage.completion!.id, expectedCompletionFingerprint: stage.completion!.fingerprint, expectedAssignmentId: stage.currentAssignment?.id ?? null, photos: [] } } })
    await coreMigrationTestInstance.confirm({ ...envelope('quantity-confirm-again'), batchId: batch.batchId }, session)
    const corrected = await quantityTestInstance.completion({ ...query, unitId })
    expect(corrected.data.stages[0]!.completion?.note).toBe('中央更正')
    expect(corrected.sourceVersion).toBe(save.sourceVersion)
    await coreMigrationTestInstance.rollback({ ...envelope('quantity-rollback'), batchId: batch.batchId }, session)
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
    await expect(quantityTestInstance.region(query)).rejects.toMatchObject({ problem: { code: 'not-found' } })
  }
  finally { db.close() }
})

it('dry-run 已发现量域内部的缺失责任身份，不等实际确认才失败', async () => {
  const db = await createMemoryDb()
  try {
    const source = await seedQuantityMigrationSource(db)
    const entity = source.entities.quantity_projects![0]!
    const graph = JSON.parse(String(entity.attributes!.graphJson))
    graph.tables.unit_assignments[0].crew_id = 'missing-crew'
    entity.attributes!.graphJson = JSON.stringify(graph)
    source.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(source)).digest('hex')
    const batch = await dryRun(source)
    expect(batch.issues).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'quantity_projects', field: 'graphJson', metricKey: 'apply-failed', reason: expect.stringContaining('班组') })]))
    await expect(coreMigrationTestInstance.importBatch({ ...envelope('quantity-import'), batchId: batch.batchId }, session)).rejects.toThrow()
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
  }
  finally { db.close() }
})
