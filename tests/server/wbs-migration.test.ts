import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '~/lib/migration/core-contract'
import { expect, it } from 'vitest'
import { CORE_MIGRATION_TOPOLOGY } from '~/lib/migration/core-contract'
import { loadScheduleHistory } from '~/lib/schedule/history'
import { createQuantityTestInstance } from '../../server/utils/quantity-test-instance'
import { planWbsMigration } from '../../server/utils/wbs-migration'
import { createMigratedMemoryDb } from '../helpers/memory-db'
import { seedWbsMigrationSource } from '../helpers/wbs-migration-source'

const projectId = 'server-project-q-project'
const query = { projectId, origin: 'real' as const, includeDemo: false }
const context = { workspaceId: 'wbs-migration-isolated', actorId: 'maintainer', capabilities: ['quantity:read', 'quantity:write', 'schedule:read', 'schedule:write', 'project:list:read'] }
const local: CoreMigrationSnapshotDTO = { authority: 'local', activeBatchId: null, entities: [] }
function target() {
  return createQuantityTestInstance({ session: () => context, projects: () => [{ id: projectId, name: '合成项目', code: 'P', dataOrigin: 'real' }, { id: 'independent-project', name: '独立项目', code: 'I', dataOrigin: 'real' }] })
}
async function snapshot() {
  const db = await createMigratedMemoryDb()
  try {
    const source = await seedWbsMigrationSource(db)
    const entities = CORE_MIGRATION_TOPOLOGY.flatMap(type => (source.entities[type] ?? []).map((row): CoreMigrationServerEntityDTO => ({
      entityType: type,
      id: type === 'projects' ? `server-project-${row.legacyId}` : `server-${type}-${row.legacyId}`,
      legacyId: row.legacyId,
      name: row.name,
      references: Object.fromEntries(Object.entries(row.references ?? {}).map(([field, id]) => [field, id === null ? null : field === 'projectId' ? `server-project-${id}` : `server-${field === 'contractId' ? 'construction_contracts' : field === 'supplierId' ? 'suppliers' : field === 'crewId' ? 'crews' : 'customers'}-${id}`])),
      quantity: row.quantity ?? null,
      amount: row.amount ?? null,
      attributes: row.attributes ?? {},
      deletedAt: row.deletedAt ?? null,
      batchId: 'wbs-isolated-batch',
    })))
    return { authority: 'central' as const, activeBatchId: 'wbs-isolated-batch', entities }
  }
  finally { db.close() }
}

it('分组名冲突时丢弃已准备的工程量候选，失败后 WBS 队列可继续读取与保存', async () => {
  const instance = target()
  try {
    await instance.withSchedule(query, db => db.execute('INSERT INTO schedule_groups (id,project_id,name,scope_basis) VALUES (?,?,?,?)', ['independent-existing-group', projectId, '已绑定的原暂估组', 'provisional']))
    const before = await instance.region(query)
    await expect(instance.prepareMigrationSnapshot(await snapshot())).rejects.toThrow('UNIQUE constraint failed: schedule_groups.project_id, schedule_groups.name')
    expect((await instance.region(query)).data).toEqual(before.data)
    expect((await instance.region(query)).sourceVersion).toBe(before.sourceVersion)
    expect(await instance.withSchedule(query, db => db.select('SELECT id FROM schedule_groups'))).toEqual([{ id: 'independent-existing-group' }])
    expect(await instance.withSchedule(query, db => db.select('SELECT * FROM schedule_tasks'))).toEqual([])
    await instance.withSchedule(query, db => db.execute('UPDATE schedule_groups SET name = ? WHERE id = ?', ['独立更正后', 'independent-existing-group']))
  }
  finally { await instance.close() }
})

it('准备期间读写等待；取消候选不留半组；重试确认和安全恢复共同切换完整图', async () => {
  const instance = target()
  try {
    const source = await snapshot()
    const prepared = await instance.prepareMigrationSnapshot(source)
    let finished = false
    const waiting = instance.withSchedule(query, async (db) => {
      const rows = await db.select('SELECT id FROM schedule_groups')
      finished = true
      return rows
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    await prepared.abort()
    expect(await waiting).toEqual([])
    const confirmed = await instance.prepareMigrationSnapshot(source)
    confirmed.commit()
    const history = await instance.withSchedule(query, db => loadScheduleHistory(db, projectId))
    expect(history.logs.map(row => row.operator)).toEqual(expect.arrayContaining(['schedule:bind-contract', 'schedule:conflict-reschedule']))
    expect(history.removedTasks).toContainEqual(expect.objectContaining({ name: '无组旧删除任务', groupId: null }))
    expect(history.migrationEvidence[0]).toMatchObject({ provisionalDetailStatus: 'legacy-detail-unavailable' })
    const independent = { ...query, projectId: 'independent-project' }
    await instance.withSchedule(independent, db => db.execute('INSERT INTO schedule_tasks (id,project_id,name,planned_start,planned_finish,has_qty,manual_progress) VALUES (?,?,?,?,?,0,0)', ['retained-task', independent.projectId, '独立保留', '2026-09-12', '2026-09-12']))
    ;(await instance.prepareMigrationSnapshot(local)).commit()
    expect(await instance.withSchedule(query, db => loadScheduleHistory(db, projectId))).toEqual({ logs: [], removedTasks: [], migrationEvidence: [] })
    expect(await instance.withSchedule(independent, db => db.select('SELECT name FROM schedule_tasks WHERE id = ?', ['retained-task']))).toEqual([{ name: '独立保留' }])
    expect((await instance.region(query)).data.buildings).toEqual([])
  }
  finally { await instance.close() }
})

it('独立其他项目 WBS 引用迁入库时也阻止撤回，不依赖同项目过滤', async () => {
  const instance = target()
  try {
    const source = await snapshot()
    ;(await instance.prepareMigrationSnapshot(source)).commit()
    const independent = { ...query, projectId: 'independent-project' }
    await instance.withSchedule(independent, db => db.execute('INSERT INTO schedule_groups (id,project_id,name,scope_basis,process_library_id,process_library_version_snapshot) VALUES (?,?,?,?,?,?)', ['independent-library-use', independent.projectId, '独立使用旧库', 'provisional', 'server-process_libraries-wbs-library', 3]))
    await expect(instance.prepareMigrationSnapshot(local)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    expect((await instance.withSchedule(query, db => loadScheduleHistory(db, projectId))).logs).toHaveLength(2)
    expect(await instance.withSchedule(independent, db => db.select('SELECT name FROM schedule_groups WHERE id = ?', ['independent-library-use']))).toEqual([{ name: '独立使用旧库' }])
  }
  finally { await instance.close() }
})

it.each([0, null])('历史冻结量 %s 与缺失任务快照照实迁入，缺单位和逐户来源明确标记', async (quantity) => {
  const instance = target()
  try {
    const source = await snapshot()
    const entity = source.entities.find(row => row.entityType === 'wbs_projects')!
    const graph = JSON.parse(String(entity.attributes.graphJson))
    graph.tables.schedule_task_floor_plans[0].provisional_qty = quantity
    graph.tables.schedule_tasks.find((row: { id: string }) => row.id === 'wbs-task').template_snapshot_json = null
    entity.attributes.graphJson = JSON.stringify(graph)
    ;(await instance.prepareMigrationSnapshot(source)).commit()
    const [row] = await instance.withSchedule(query, db => db.select<{ provisional_qty: number | null, template_snapshot_json: string | null, snapshot_json: string, legacy_missing: number }>('SELECT f.provisional_qty,t.template_snapshot_json,q.snapshot_json,q.legacy_missing FROM schedule_task_floor_plans f JOIN schedule_tasks t ON t.id=f.task_id JOIN schedule_floor_quantity_snapshots q ON q.id=f.id'))
    expect(row).toMatchObject({ provisional_qty: quantity, template_snapshot_json: null, legacy_missing: 1 })
    expect(JSON.parse(row!.snapshot_json)).toMatchObject({ value: quantity, unit: null, sourceSnapshot: null })
  }
  finally { await instance.close() }
})

it('同项目另一有效合同的清单不能混入本组合同楼层计划', async () => {
  const source = await snapshot()
  const contract = source.entities.find(row => row.entityType === 'construction_contracts')!
  source.entities.push({ ...structuredClone(contract), id: 'central-second-contract', legacyId: 'legacy-second-contract' })
  const quantity = source.entities.find(row => row.entityType === 'quantity_projects')!
  const quantityGraph = JSON.parse(String(quantity.attributes.graphJson))
  quantityGraph.boqReferences.find((row: { id: string }) => row.id === 'q-boq').contractId = 'legacy-second-contract'
  quantity.attributes.graphJson = JSON.stringify(quantityGraph)
  const wbs = source.entities.find(row => row.entityType === 'wbs_projects')!
  const graph = JSON.parse(String(wbs.attributes.graphJson))
  Object.assign(graph.tables.schedule_task_floor_plans[0], { source_basis: 'contract', provisional_qty: null, boq_line_id: 'q-boq' })
  wbs.attributes.graphJson = JSON.stringify(graph)
  expect(() => planWbsMigration(source, new Map())).toThrow('任务或楼层清单不属于分组明确施工合同')
})
