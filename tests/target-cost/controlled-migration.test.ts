import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { createMemoryDb, createMigratedMemoryDb } from '../helpers/memory-db'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'
import { seedTargetCostMigrationSource } from '../helpers/target-cost-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
async function prepare(source: CoreMigrationSourceDTO) {
  await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('budget-preflight'), source, backup: null }), session)
  const hash = 'd'.repeat(64)
  return coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('budget-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 412, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
}
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

it.each(['untouched', 'independent-project', 'deleted-independent-project', 'historical-project', 'independent-item', 'receipt'] as const)('恢复预算迁入时保护可解释来源：%s', async (kind) => {
  const db = await createMemoryDb()
  try {
    const batch = await prepare(await seedTargetCostMigrationSource(db))
    await coreMigrationTestInstance.importBatch({ ...envelope('budget-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('budget-confirm'), batchId: batch.batchId }, session)
    const id = batch.mappings.find(row => row.entityType === 'target_cost_versions' && row.legacyId === 'budget-a')!.serverId
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    await quantityTestInstance.withWorkspaceTransaction(async (central) => {
      if (kind === 'independent-project' || kind === 'deleted-independent-project')
        await central.execute('INSERT INTO target_costs(id,project_id,name,deleted_at) VALUES (?,?,?,?)', ['independent', projectId, '独立预算', kind === 'deleted-independent-project' ? '2026-09-13T01:00:00.000Z' : null])
      if (kind === 'historical-project') {
        await central.execute('INSERT INTO target_costs(id,name) VALUES (?,?)', ['independent', '改为无项目的独立草稿'])
        await central.execute('INSERT INTO operation_logs(id,table_name,record_id,action,before_data,after_data) VALUES (?,\'target_costs\',?,\'update\',?,?)', ['independent-log', 'independent', JSON.stringify({ id: 'independent', project_id: projectId }), JSON.stringify({ id: 'independent', project_id: null })])
      }
      if (kind === 'independent-item')
        await central.execute('INSERT INTO target_cost_items(id,target_cost_id,cost_category,amount) VALUES (?,?,?,?)', ['independent-item', id, '材料', 2])
      if (kind === 'receipt')
        await central.execute('INSERT INTO target_cost_command_receipts VALUES (?,?,?,?,?,?)', ['budget-daily', session.actorId, id, 'save-items', 'fingerprint', '{}'])
    })
    const snapshot = coreMigrationTestInstance.snapshot(session)
    const query = () => quantityTestInstance.withWorkspaceTransaction(async central => ({ heads: await central.select('SELECT * FROM target_costs ORDER BY id'), items: await central.select('SELECT * FROM target_cost_items ORDER BY id'), files: await central.select('SELECT * FROM file_refs'), payloads: await central.select('SELECT * FROM file_payloads'), logs: await central.select('SELECT * FROM operation_logs ORDER BY id'), receipts: await central.select('SELECT * FROM target_cost_command_receipts'), revision: await central.select('SELECT * FROM target_cost_revision') }))
    const before = await query()
    if (kind === 'untouched') {
      await coreMigrationTestInstance.rollback({ ...envelope('budget-safe-rollback'), batchId: batch.batchId }, session)
      expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
      const after = await query()
      expect(after.heads).toEqual([])
      expect(after.items).toEqual([])
      expect(after.files).toEqual([])
      expect(after.payloads).toEqual([])
      expect(after.logs).toEqual([])
      expect(after.revision).toEqual([{ singleton: 1, revision: 2 }])
    }
    else {
      await expect(coreMigrationTestInstance.rollback({ ...envelope('budget-block-rollback'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
      expect(coreMigrationTestInstance.snapshot(session)).toEqual(snapshot)
      expect(await query()).toEqual(before)
    }
  }
  finally { db.close() }
})

it('项目迁入没有预算图时，日常独立预算仍会阻止项目恢复', async () => {
  const db = await createMigratedMemoryDb()
  try {
    await seedTargetCostMigrationSource(db)
    await db.execute('DELETE FROM operation_logs')
    await db.execute('DELETE FROM file_payloads')
    await db.execute('DELETE FROM file_refs')
    await db.execute('DELETE FROM target_cost_items')
    await db.execute('DELETE FROM target_costs')
    const batch = await prepare(await readQuantityCoreSource(db))
    await coreMigrationTestInstance.importBatch({ ...envelope('project-only-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('project-only-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    await quantityTestInstance.withWorkspaceTransaction(async (central) => {
      await central.execute('INSERT INTO projects(id,name) VALUES (?,?)', [projectId, '日常投影'])
      await central.execute('INSERT INTO target_costs(id,project_id,name) VALUES (?,?,?)', ['independent', projectId, '日常预算'])
    })
    await expect(coreMigrationTestInstance.rollback({ ...envelope('project-only-rollback'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
  }
  finally { db.close() }
})

it.each(['duplicate-baseline', 'wrong-project', 'orphan-item', 'broken-payload'] as const)('试跑阻断完整预算来源错误：%s', async (kind) => {
  const db = await createMigratedMemoryDb()
  try {
    const source = await seedTargetCostMigrationSource(db)
    const entity = source.entities.target_cost_versions![kind === 'duplicate-baseline' ? 1 : 0]!
    const graph = JSON.parse(String(entity.attributes!.budgetGraphJson))
    if (kind === 'duplicate-baseline') {
      graph.head.project_id = 'budget-project'
      graph.head.is_baseline = 1
      entity.references!.projectId = 'budget-project'
    }
    if (kind === 'wrong-project')
      graph.head.project_id = 'foreign-project'
    if (kind === 'orphan-item')
      graph.items[0].target_cost_id = 'other-budget'
    if (kind === 'broken-payload')
      graph.payloads[0].content = 'broken'
    entity.attributes!.budgetGraphJson = JSON.stringify(graph)
    source.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(source)).digest('hex')
    const batch = await prepare(source)
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'target_cost_versions', field: 'budgetGraphJson', metricKey: 'apply-failed' }))
    await expect(coreMigrationTestInstance.importBatch({ ...envelope('budget-invalid-import'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
  }
  finally { db.close() }
})

it('正式迁入完整预算版本，空项目/旧空分项名/零/删除历史/缺原件保真，重复确认保日常更正', async () => {
  const db = await createMemoryDb()
  try {
    const batch = await prepare(await seedTargetCostMigrationSource(db))
    expect(batch.issues.filter(row => row.metricKey === 'apply-failed')).toEqual([])
    await coreMigrationTestInstance.importBatch({ ...envelope('budget-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('budget-confirm'), batchId: batch.batchId }, session)
    const id = batch.mappings.find(row => row.entityType === 'target_cost_versions' && row.legacyId === 'budget-a')!.serverId
    const emptyId = batch.mappings.find(row => row.entityType === 'target_cost_versions' && row.legacyId === 'budget-b')!.serverId
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    const read = () => quantityTestInstance.withWorkspaceTransaction(async central => ({
      heads: await central.select('SELECT id,project_id,name,contract_revenue,planned_profit FROM target_costs ORDER BY id'),
      items: await central.select('SELECT id,target_cost_id,item_name,qty,unit_price,amount,sort_order,deleted_at FROM target_cost_items ORDER BY id'),
      files: await central.select('SELECT id,owner_id FROM file_refs WHERE owner_type = \'target_cost\''),
      payloads: await central.select('SELECT * FROM file_payloads'),
      logs: await central.select('SELECT * FROM operation_logs WHERE table_name = \'target_cost_items\''),
    }))
    const migrated = await read()
    expect(migrated.heads).toContainEqual({ id, project_id: projectId, name: '原当前预算', contract_revenue: null, planned_profit: 0 })
    expect(migrated.heads).toContainEqual({ id: emptyId, project_id: null, name: '', contract_revenue: null, planned_profit: 0 })
    expect(migrated.items).toContainEqual(expect.objectContaining({ target_cost_id: id, item_name: null, qty: null, unit_price: null, amount: 0, sort_order: 4 }))
    expect(migrated.items).toContainEqual(expect.objectContaining({ deleted_at: '2026-09-12T12:00:00.000Z' }))
    expect(migrated.files).toHaveLength(2)
    expect(migrated.payloads).toHaveLength(1)
    expect(migrated.logs).toHaveLength(1)
    await quantityTestInstance.withWorkspaceTransaction(central => central.execute('UPDATE target_costs SET name = ? WHERE id = ?', ['中央更正', id]))
    const repeated = await quantityTestInstance.prepareMigrationSnapshot(coreMigrationTestInstance.snapshot(session))
    repeated.commit()
    await coreMigrationTestInstance.confirm({ ...envelope('budget-repeat'), batchId: batch.batchId }, session)
    expect((await read()).heads).toContainEqual(expect.objectContaining({ id, name: '中央更正' }))
    await expect(coreMigrationTestInstance.rollback({ ...envelope('budget-danger'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('central')
    expect((await read()).heads).toContainEqual(expect.objectContaining({ id, name: '中央更正' }))
  }
  finally { db.close() }
})
