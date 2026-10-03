import type { CoreMigrationSourceDTO } from '~/lib/migration/core-contract'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { CORE_MIGRATION_CAPABILITY, coreMigrationSourceHashInput } from '~/lib/migration/core-contract'
import { parseWbsMigrationGraph } from '~/lib/migration/wbs-source'
import { resolveBusinessSession } from '../../server/utils/business-session'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { coreMigrationTestInstance } from '../../server/utils/core-migration-test-instance'
import { quantityTestInstance } from '../../server/utils/quantity-runtime'
import { scheduleService } from '../../server/utils/schedule-runtime'
import { createMemoryDb } from '../helpers/memory-db'
import { readQuantityCoreSource } from '../helpers/quantity-migration-source'
import { seedWbsMigrationSource } from '../helpers/wbs-migration-source'

const session = resolveBusinessSession()
const envelope = (commandId: string) => ({ workspaceId: session.workspaceId, actorId: session.actorId, requiredCapability: CORE_MIGRATION_CAPABILITY, commandId })
async function prepare(source: CoreMigrationSourceDTO) {
  await coreMigrationTestInstance.preflight(parseCoreMigrationSourceCommand({ ...envelope('wbs-preflight'), source, backup: null }), session)
  const hash = 'd'.repeat(64)
  return coreMigrationTestInstance.dryRun(parseCoreMigrationSourceCommand({ ...envelope('wbs-dry'), source, backup: { backupId: `core-migration-${source.sourceHash}-${hash}`, sourceHash: source.sourceHash, sourceVersion: source.sourceVersion, snapshotSha256: hash, byteLength: 444, createdAt: '2026-09-15T00:00:00.000Z', immutable: true } }), session)
}
afterEach(async () => {
  await quantityTestInstance.reset()
  await coreMigrationTestInstance.reset(session.workspaceId)
})

it('完整 SQLite 图经确认原子迁入，绑定历史/软禁用/无组任务/冻结8与人工楼层均可读；重复确认保日常更正', async () => {
  const db = await createMemoryDb()
  try {
    const source = await seedWbsMigrationSource(db)
    const boq = JSON.parse(String(source.entities.construction_contracts[0]!.attributes!.boqCatalogJson))
    expect(boq).toContainEqual(expect.objectContaining({ id: 'wbs-contract-boq', building: '合同待建二栋', unitType: '合同待建户型', floorZone: '一层' }))
    const graph = parseWbsMigrationGraph(JSON.parse(String(source.entities.wbs_projects![0]!.attributes!.graphJson)))
    expect(graph.tables.schedule_tasks).toHaveLength(3)
    expect(graph.tables.operation_logs).toHaveLength(2)
    const batch = await prepare(source)
    expect(batch.issues.filter(row => row.metricKey === 'apply-failed')).toEqual([])
    await coreMigrationTestInstance.importBatch({ ...envelope('wbs-import'), batchId: batch.batchId }, session)
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
    await coreMigrationTestInstance.confirm({ ...envelope('wbs-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    const wbs = batch.mappings.find(row => row.entityType === 'wbs_projects')!.serverId
    const quantity = batch.mappings.find(row => row.entityType === 'quantity_projects')!.serverId
    const query = { projectId, origin: 'real' as const, includeDemo: false }
    const result = await quantityTestInstance.withSchedule(query, async central => ({
      groups: await central.select<Record<string, unknown>>('SELECT * FROM schedule_groups'),
      tasks: await central.select<Record<string, unknown>>('SELECT * FROM schedule_tasks'),
      plans: await central.select<Record<string, unknown>>('SELECT * FROM schedule_task_floor_plans'),
      logs: await central.select<Record<string, unknown>>('SELECT * FROM operation_logs WHERE table_name IN (\'schedule_groups\',\'task_dependencies\')'),
      quantities: await central.select<Record<string, unknown>>('SELECT * FROM schedule_floor_quantity_snapshots'),
    }))
    expect(result.groups[0]).toMatchObject({ scope_basis: 'contract', contract_id: batch.mappings.find(row => row.entityType === 'construction_contracts')!.serverId })
    expect(result.tasks).toContainEqual(expect.objectContaining({ id: `${wbs}:schedule_tasks:wbs-ungrouped`, group_id: null, deleted_at: '2026-08-02T01:00:00.000Z' }))
    expect(result.plans[0]).toMatchObject({ source_basis: 'provisional', provisional_qty: 8, floor_id: `${quantity}:floors:q-floor`, is_manual: 1 })
    expect(result.quantities[0]).toMatchObject({ legacy_missing: 1 })
    expect(JSON.parse(String(result.quantities[0]!.snapshot_json))).toMatchObject({ value: 8, unit: null, completeness: 'legacy-detail-unavailable' })
    const binding = result.logs.find(row => row.operator === 'schedule:bind-contract')!
    expect(JSON.parse(String(binding.before_data))).toMatchObject({ id: result.groups[0]!.id, contract_id: null, scope_basis: 'provisional' })
    expect(JSON.parse(String(binding.after_data))).toMatchObject({ contract_id: result.groups[0]!.contract_id })
    await quantityTestInstance.withSchedule(query, central => central.execute('UPDATE schedule_tasks SET name = ? WHERE id = ?', ['中央日常更正', `${wbs}:schedule_tasks:wbs-task`]))
    await coreMigrationTestInstance.confirm({ ...envelope('wbs-confirm-again'), batchId: batch.batchId }, session)
    expect(await quantityTestInstance.withSchedule(query, central => central.select('SELECT name FROM schedule_tasks WHERE id = ?', [`${wbs}:schedule_tasks:wbs-task`]))).toEqual([{ name: '中央日常更正' }])
    const completionBefore = await quantityTestInstance.completion({ ...query, unitId: `${quantity}:units:q-unit` })
    await quantityTestInstance.withSchedule(query, central => central.execute('INSERT INTO schedule_tasks (id,project_id,name,planned_start,planned_finish,has_qty,manual_progress) VALUES (?,?,?,?,?,0,0)', ['independent-wbs', projectId, '独立新计划', '2026-09-12', '2026-09-12']))
    const before = coreMigrationTestInstance.snapshot(session)
    await expect(coreMigrationTestInstance.rollback({ ...envelope('wbs-dangerous-rollback'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(before)
    const completionAfter = await quantityTestInstance.completion({ ...query, unitId: `${quantity}:units:q-unit` })
    expect(completionAfter.data).toEqual(completionBefore.data)
    expect(completionAfter.sourceVersion).toBe(completionBefore.sourceVersion)
    expect(await quantityTestInstance.withSchedule(query, central => central.select('SELECT id FROM schedule_tasks WHERE id = ?', ['independent-wbs']))).toEqual([{ id: 'independent-wbs' }])
  }
  finally { db.close() }
})

it.each(['missing-floor', 'foreign-stage', 'wrong-library-version', 'snapshot-library-mismatch', 'orphan-log', 'cycle'] as const)('试跑阶段阻断损坏完整图 %s，不能改变接管状态', async (kind) => {
  const db = await createMemoryDb()
  try {
    const source = await seedWbsMigrationSource(db)
    const entity = source.entities.wbs_projects![0]!
    const graph = JSON.parse(String(entity.attributes!.graphJson))
    if (kind === 'missing-floor')
      graph.tables.schedule_task_floor_plans[0].floor_id = 'missing'
    if (kind === 'foreign-stage')
      graph.tables.schedule_tasks.find((row: { id: string }) => row.id === 'wbs-task').stage_id = 'another-project-stage'
    if (kind === 'wrong-library-version')
      graph.tables.schedule_groups[0].process_library_version_snapshot = 99
    if (kind === 'snapshot-library-mismatch') {
      const task = graph.tables.schedule_tasks.find((row: { id: string }) => row.id === 'wbs-task')
      task.template_snapshot_json = JSON.stringify({ ...JSON.parse(task.template_snapshot_json), libraryId: 'schedule_process_library_decoration_v1' })
    }
    if (kind === 'orphan-log')
      graph.tables.operation_logs[0].record_id = 'missing'
    if (kind === 'cycle')
      graph.tables.schedule_tasks[0].parent_id = graph.tables.schedule_tasks[0].id
    entity.attributes!.graphJson = JSON.stringify(graph)
    source.sourceHash = createHash('sha256').update(coreMigrationSourceHashInput(source)).digest('hex')
    const batch = await prepare(source)
    expect(batch.issues).toContainEqual(expect.objectContaining({ entityType: 'wbs_projects', field: 'graphJson', metricKey: 'apply-failed' }))
    await expect(coreMigrationTestInstance.importBatch({ ...envelope('wbs-invalid-import'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(session).authority).toBe('local')
  }
  finally { db.close() }
})

it.each([false, true])('迁入后新绑定经重复确认保持不变，危险恢复即使审计缺失=%s也不能吞掉新合同关系', async (missingAudit) => {
  const db = await createMemoryDb()
  try {
    await seedWbsMigrationSource(db)
    await db.execute('UPDATE schedule_groups SET contract_id = NULL, scope_basis = \'provisional\', contract_bound_at = NULL WHERE id = \'wbs-group\'')
    await db.execute('DELETE FROM operation_logs WHERE id = \'wbs-bind-log\'')
    const batch = await prepare(await readQuantityCoreSource(db))
    await coreMigrationTestInstance.importBatch({ ...envelope('binding-import'), batchId: batch.batchId }, session)
    await coreMigrationTestInstance.confirm({ ...envelope('binding-confirm'), batchId: batch.batchId }, session)
    const projectId = batch.mappings.find(row => row.entityType === 'projects')!.serverId
    const groupId = `${batch.mappings.find(row => row.entityType === 'wbs_projects')!.serverId}:schedule_groups:wbs-group`
    const contractId = batch.mappings.find(row => row.entityType === 'construction_contracts')!.serverId
    const query = { projectId, origin: 'real' as const, includeDemo: false }
    const preview = await scheduleService.binding(query, groupId, contractId)
    expect(preview.preview!.canBind).toBe(true)
    const command = { commandId: 'bind-imported', workspaceId: session.workspaceId, actorId: session.actorId, origin: 'real' as const, projectId, requiredCapability: 'schedule:write' as const, sourceVersion: preview.sourceVersion, action: { kind: 'bind-contract' as const, groupId, contractId } }
    const saved = await scheduleService.execute(command)
    await coreMigrationTestInstance.confirm({ ...envelope('binding-repeat-confirm'), batchId: batch.batchId }, session)
    expect((await scheduleService.binding(query, groupId)).binding).toEqual((saved.value as { binding: unknown }).binding)
    expect(await scheduleService.execute(command)).toEqual(saved)
    if (missingAudit) {
      await quantityTestInstance.withSchedule(query, async (central) => {
        await central.execute('DELETE FROM operation_logs WHERE record_id = ? AND operator = \'schedule:bind-contract\'', [groupId])
        await central.execute('DELETE FROM schedule_command_receipts WHERE command_id = ?', [command.commandId])
      })
    }
    const before = coreMigrationTestInstance.snapshot(session)
    const bindingBefore = await scheduleService.binding(query, groupId)
    const readBefore = await scheduleService.read(query)
    await expect(coreMigrationTestInstance.rollback({ ...envelope('binding-unsafe-restore'), batchId: batch.batchId }, session)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect(coreMigrationTestInstance.snapshot(session)).toEqual(before)
    expect(await scheduleService.binding(query, groupId)).toEqual(bindingBefore)
    expect(await scheduleService.read(query)).toEqual(readBefore)
  }
  finally { db.close() }
})
