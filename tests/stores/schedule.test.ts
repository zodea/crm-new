import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { SCHEDULE_TASK_TEMPLATES } from '~/lib/schedule/template'
import { useScheduleStore } from '~/stores/schedule'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
    await mem.execute('BEGIN')
    try {
      const result = await work(mem)
      await mem.execute('COMMIT')
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('p1', '演示项目')`)
  await mem.execute(`INSERT INTO buildings (id, project_id, code, name) VALUES
    ('b1', 'p1', '1', '1栋')`)
  await mem.execute(`INSERT INTO contracts (id, name, kind, project_id) VALUES
    ('contract-main', '演示施工合同', '施工', 'p1')`)
  await mem.execute(`INSERT INTO items (id, project_id, code, name, trade) VALUES
    ('i-wp-wall', 'p1', 'WP-WALL', '墙面防水', '防水工'),
    ('i-wp-floor', 'p1', 'WP-FLOOR', '地面防水', '防水工')`)
  await mem.execute(`INSERT INTO boq_files (id, contract_id, file_name, parse_status, line_count) VALUES
    ('boq-file', 'contract-main', '演示清单.xlsx', 'parsed', 2)`)
  await mem.execute(`INSERT INTO boq_lines
    (id, boq_file_id, project_id, contract_id, item_id, item_name, qty, unit_price, trace_key, sort_order) VALUES
    ('boq-wall', 'boq-file', 'p1', 'contract-main', 'i-wp-wall', '墙面防水', 20, 50, 'demo·1', 10),
    ('boq-floor', 'boq-file', 'p1', 'contract-main', 'i-wp-floor', '地面防水', 8, 60, 'demo·2', 20)`)
  await mem.execute(`INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES
    ('s-wp', 'p1', 'WP-02', '防水二遍', '防水工')`)
  await mem.execute(`INSERT INTO construction_stage_items (id, stage_id, item_id) VALUES
    ('csi-wall', 's-wp', 'i-wp-wall'),
    ('csi-floor', 's-wp', 'i-wp-floor')`)
  setActivePinia(createPinia())
})

describe('schedule store：排程唯一 action 写路径', () => {
  it('建组、改期/人工进度、设基线、增删工序均真实持久化', async () => {
    const store = useScheduleStore()
    await store.loadContracts('p1')
    expect(store.contracts).toEqual([
      expect.objectContaining({ id: 'contract-main', lineCount: 2 }),
    ])
    const settingOut = SCHEDULE_TASK_TEMPLATES.find(template => template.key === 'setting-out')!
    const waterproof = SCHEDULE_TASK_TEMPLATES.find(template => template.key === 'waterproof')!
    const groupId = await store.createGroup({
      projectId: 'p1',
      contractId: 'contract-main',
      name: '户内1栋',
      buildingIds: ['b1'],
      startDate: '2026-07-01',
      overlapMode: 'half',
      tasks: [
        { templateKey: settingOut.key, enabled: true, durationDays: 10, anchorStart: null },
        { templateKey: waterproof.key, enabled: true, durationDays: 8, anchorStart: null },
      ],
    }, '2026-07-01')

    expect(store.snapshot?.groups[0]).toMatchObject({
      id: groupId,
      contractId: 'contract-main',
      buildingIds: ['b1'],
    })
    const manualTask = store.snapshot!.groups[0]!.tasks.find(task => !task.hasQty)!
    const automaticTask = store.snapshot!.groups[0]!.tasks.find(task => task.hasQty)!
    expect(automaticTask.boqLineIds).toEqual(['boq-floor', 'boq-wall'])
    expect(await mem.select(`
      SELECT contract_id FROM schedule_groups WHERE id = ?
    `, [groupId])).toEqual([{ contract_id: 'contract-main' }])

    const dependencyLog = await store.updateDependency(automaticTask.id, manualTask.id, 3, '2026-07-01')
    expect(dependencyLog.logId).toBeTruthy()
    expect(dependencyLog.conflicts).not.toHaveLength(0)
    const [dependency] = await mem.select<{ dependency_type: string, lag_days: number }>(
      `SELECT dependency_type, lag_days FROM task_dependencies WHERE succ_id = ? AND deleted_at IS NULL`,
      [automaticTask.id],
    )
    expect(dependency).toEqual({ dependency_type: 'FS', lag_days: 3 })

    const updated = await store.updateTask(manualTask.id, {
      plannedFinish: '2026-07-20',
      manualProgress: 0.6,
    }, '2026-07-01')
    expect(updated.logId).toBeTruthy()
    expect(updated.conflicts).not.toHaveLength(0)
    expect(store.snapshot!.groups[0]!.tasks.find(task => task.id === manualTask.id))
      .toMatchObject({ plannedFinish: '2026-07-20', actualProgress: 0.6 })
    await expect(store.updateTask(automaticTask.id, { manualProgress: 0.9 }, '2026-07-01'))
      .rejects
      .toThrow(/工程量联动工序不能人工填报/)

    const baselineLogs = await store.setBaseline('p1', '2026-07-01')
    expect(baselineLogs).toHaveLength(2)
    expect(store.snapshot!.groups[0]!.tasks.every(task => task.baselineStart === task.plannedStart)).toBe(true)

    const addedId = await store.addTask(groupId, {
      templateKey: 'air-conditioning',
      plannedStart: '2026-08-01',
    }, '2026-07-01')
    expect(store.snapshot!.groups[0]!.tasks.some(task => task.id === addedId)).toBe(true)
    const deleteLog = await store.removeTask(addedId, '2026-07-01')
    expect(deleteLog).toBeTruthy()
    expect(store.snapshot!.groups[0]!.tasks.some(task => task.id === addedId)).toBe(false)
  })
})
