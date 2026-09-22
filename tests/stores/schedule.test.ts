import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { SCHEDULE_TASK_TEMPLATES } from '~/lib/schedule/template'
import { useScheduleStore } from '~/stores/schedule'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

async function addProvisionalBuilding(buildingId: string, floorId: string, itemId: string) {
  await mem.execute('INSERT INTO house_type_templates (id, project_id, code, name) VALUES (?, ?, ?, ?)', [`template-${buildingId}`, 'p1', buildingId, `${buildingId}户型`])
  await mem.execute('INSERT INTO rooms (id, template_id, code, name) VALUES (?, ?, ?, ?)', [`room-${buildingId}`, `template-${buildingId}`, 'whole', '整户'])
  await mem.execute('INSERT INTO units (id, floor_id, house_type_template_id, code, name) VALUES (?, ?, ?, ?, ?)', [`unit-${buildingId}`, floorId, `template-${buildingId}`, '1', '一户'])
  await mem.execute('INSERT INTO house_type_template_items (id, room_id, item_id, provisional_qty) VALUES (?, ?, ?, ?)', [`line-${buildingId}`, `room-${buildingId}`, itemId, 0])
}

// 此套件验证桌面 SQLite WBS 适配；浏览器来源在独立中央库套件验证。
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))

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
    ('b1', 'p1', '1', '1栋'),
    ('b2', 'p1', '2', '2栋')`)
  await mem.execute(`INSERT INTO floors (id, building_id, code, name) VALUES
    ('f1', 'b1', '1', '1层'),
    ('f1b', 'b1', '2', '2层'),
    ('f2', 'b2', '1', '1层')`)
  await mem.execute(`INSERT INTO contracts (id, name, kind, project_id) VALUES
    ('contract-main', '演示施工合同', '施工', 'p1')`)
  await mem.execute(`INSERT INTO items (id, project_id, code, name, trade) VALUES
    ('i-wp-wall', 'p1', 'WP-WALL', '墙面防水', '防水工'),
    ('i-wp-floor', 'p1', 'WP-FLOOR', '地面防水', '防水工')`)
  await mem.execute(`INSERT INTO boq_files (id, contract_id, file_name, parse_status, line_count) VALUES
    ('boq-file', 'contract-main', '演示清单.xlsx', 'parsed', 3)`)
  await mem.execute(`INSERT INTO boq_lines
    (id, boq_file_id, project_id, contract_id, item_id, item_name, qty, unit_price,
     trace_key, building, floor_zone, sort_order) VALUES
    ('boq-wall', 'boq-file', 'p1', 'contract-main', 'i-wp-wall', '墙面防水', 20, 50, 'demo·1', '1', '1层', 10),
    ('boq-wall-2', 'boq-file', 'p1', 'contract-main', 'i-wp-wall', '墙面防水', 18, 50, 'demo·2', '1', '2层', 20),
    ('boq-floor', 'boq-file', 'p1', 'contract-main', 'i-wp-floor', '地面防水', 8, 60, 'demo·3', '1', '', 30)`)
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
      expect.objectContaining({ id: 'contract-main', lineCount: 3 }),
    ])
    await store.loadBuildings('p1', 'contract-main')
    expect(store.buildings.map(building => building.id)).toEqual(['b1'])
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
    expect(automaticTask.boqLineIds).toEqual(['boq-floor', 'boq-wall', 'boq-wall-2'])
    expect(automaticTask.floorPlans).toHaveLength(4)
    expect(automaticTask.floorPlans).toEqual(expect.arrayContaining([
      expect.objectContaining({ floorId: 'f1', boqLineId: 'boq-wall', isManual: false }),
      expect.objectContaining({ floorId: 'f1b', boqLineId: 'boq-wall-2', isManual: false }),
      expect.objectContaining({ floorId: 'f1', boqLineId: 'boq-floor', isManual: false }),
      expect.objectContaining({ floorId: 'f1b', boqLineId: 'boq-floor', isManual: false }),
    ]))
    await mem.execute(`
      CREATE TRIGGER fail_schedule_dependency_update
      BEFORE UPDATE ON task_dependencies
      BEGIN
        SELECT RAISE(ABORT, 'dependency write failed');
      END
    `)
    await expect(store.saveTaskPlan(automaticTask.id, {
      task: { plannedFinish: '2026-07-28' },
      floorPlans: [],
      dependency: { predecessorId: manualTask.id, lagDays: 2 },
      disableDependencyIds: [store.snapshot!.dependencies[0]!.id],
    }, '2026-07-01')).rejects.toThrow('dependency write failed')
    expect(await mem.select<{ planned_finish: string }>(
      `SELECT planned_finish FROM schedule_tasks WHERE id = ?`,
      [automaticTask.id],
    )).toEqual([{ planned_finish: automaticTask.plannedFinish }])
    await mem.execute(`DROP TRIGGER fail_schedule_dependency_update`)
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

    const floorPlan = store.snapshot!.groups[0]!.tasks
      .find(task => task.id === automaticTask.id)!
      .floorPlans[0]!
    const floorPlanLogs = await store.updateFloorPlans(automaticTask.id, [{
      id: floorPlan.id,
      plannedStart: '2026-07-18',
      plannedFinish: '2026-07-21',
    }], '2026-07-01')
    expect(floorPlanLogs).toHaveLength(1)
    expect(store.snapshot!.groups[0]!.tasks
      .find(task => task.id === automaticTask.id)!
      .floorPlans
      .find(plan => plan.id === floorPlan.id))
      .toMatchObject({
        plannedStart: '2026-07-18',
        plannedFinish: '2026-07-21',
        isManual: true,
      })
    await store.updateTask(automaticTask.id, {
      plannedFinish: '2026-07-30',
    }, '2026-07-01')
    const rescheduledPlans = store.snapshot!.groups[0]!.tasks
      .find(task => task.id === automaticTask.id)!
      .floorPlans
    expect(rescheduledPlans.find(plan => plan.id === floorPlan.id)).toMatchObject({
      plannedStart: '2026-07-18',
      plannedFinish: '2026-07-21',
      isManual: true,
    })
    expect(rescheduledPlans.find(plan => plan.boqLineId === 'boq-wall-2')).toMatchObject({
      plannedStart: automaticTask.plannedStart,
      plannedFinish: '2026-07-30',
      isManual: false,
    })

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

    await store.loadBuildings('p1', 'contract-main')
    expect(store.buildings).toEqual([])
    expect(store.buildingCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'b1', inContract: true, scheduled: true }),
      expect.objectContaining({ id: 'b2', inContract: false, scheduled: false }),
    ]))
  })

  it('无合同时可按内部暂估范围建组，并冻结标准工序库快照', async () => {
    const store = useScheduleStore()
    await store.loadProcessLibraries()
    await mem.execute(`
      INSERT INTO house_type_templates (id, project_id, code, name)
      VALUES ('template-b2', 'p1', 'B', 'B户型')
    `)
    await mem.execute(`
      INSERT INTO rooms (id, template_id, code, name)
      VALUES ('room-b2', 'template-b2', 'whole', '整户')
    `)
    await mem.execute(`
      INSERT INTO units (id, floor_id, house_type_template_id, code, name)
      VALUES ('unit-b2', 'f2', 'template-b2', '101', '101户')
    `)
    await mem.execute(`
      INSERT INTO house_type_template_items
        (id, room_id, item_id, provisional_qty, sort_order)
      VALUES
        ('hti-b2-wall', 'room-b2', 'i-wp-wall', 12.5, 10),
        ('hti-b2-floor', 'room-b2', 'i-wp-floor', 8, 20)
    `)

    expect(store.processLibraries).toEqual([
      expect.objectContaining({
        code: 'decoration-standard-v1',
        name: '精装修标准工序',
        version: 1,
        taskCount: 22,
      }),
    ])
    const libraryId = store.processLibraries[0]!.id
    await store.loadProcessLibraryTasks(libraryId)
    const settingOut = store.processTasks.find(task => task.key === 'setting-out')!
    const waterproof = store.processTasks.find(task => task.key === 'waterproof')!

    await store.loadBuildings('p1')
    expect(store.buildings.map(building => building.id)).toEqual(['b1', 'b2'])
    const provisionalPreview = await store.previewProvisionalScope(['b1', 'b2'])
    expect(provisionalPreview.quantities).toEqual([expect.objectContaining({ unit: '', unitMissing: true, value: null, knownValue: null, completeness: 'partial' })])
    expect(provisionalPreview.buildings).toEqual([
      expect.objectContaining({
        buildingId: 'b1',
        floorCount: 2,
        unitCount: 0,
        typedUnitCount: 0,
        itemCount: 0,
        totalQty: 0,
      }),
      expect.objectContaining({
        buildingId: 'b2',
        floorCount: 1,
        unitCount: 1,
        typedUnitCount: 1,
        itemCount: 2,
        totalQty: 20.5,
      }),
    ])
    await expect(store.createGroup({
      projectId: 'p1',
      scopeBasis: 'provisional',
      contractId: null,
      processLibraryId: libraryId,
      name: '内部暂估·混选空楼栋',
      buildingIds: ['b1', 'b2'],
      startDate: '2026-07-01',
      overlapMode: 'seq',
      tasks: [
        { templateKey: waterproof.key, enabled: true, durationDays: 8, anchorStart: null },
      ],
    }, '2026-07-01')).rejects.toThrow(/b1.*缺少户/)

    const groupId = await store.createGroup({
      projectId: 'p1',
      scopeBasis: 'provisional',
      contractId: null,
      processLibraryId: libraryId,
      name: '内部暂估·2栋',
      buildingIds: ['b2'],
      startDate: '2026-07-01',
      overlapMode: 'seq',
      tasks: [
        { templateKey: settingOut.key, enabled: true, durationDays: 9, anchorStart: null },
        { templateKey: waterproof.key, enabled: true, durationDays: 8, anchorStart: null },
      ],
    }, '2026-07-01')

    expect(store.snapshot?.groups[0]).toMatchObject({
      id: groupId,
      scopeBasis: 'provisional',
      contractId: '',
      processLibraryId: libraryId,
      processLibraryName: '精装修标准工序',
      processLibraryVersion: 1,
      buildingIds: ['b2'],
    })
    expect(store.snapshot?.groups[0]!.tasks[0]).toMatchObject({
      name: '放线及新建墙体',
      durationDays: 9,
      sourceLibraryTaskId: settingOut.id,
      sourceLibraryVersion: 1,
    })

    const [persistedGroup] = await mem.select<{
      scope_basis: string
      contract_id: string | null
      process_library_name_snapshot: string
    }>(`
      SELECT scope_basis, contract_id, process_library_name_snapshot
      FROM schedule_groups
      WHERE id = ?
    `, [groupId])
    expect(persistedGroup).toEqual({
      scope_basis: 'provisional',
      contract_id: null,
      process_library_name_snapshot: '精装修标准工序',
    })

    const [persistedTask] = await mem.select<{
      name: string
      duration_days: number
      template_snapshot_json: string
    }>(`
      SELECT name, duration_days, template_snapshot_json
      FROM schedule_tasks
      WHERE group_id = ?
    `, [groupId])
    expect(JSON.parse(persistedTask!.template_snapshot_json)).toMatchObject({
      key: 'setting-out',
      name: '放线及新建墙体',
      durationDays: 9,
      libraryVersion: 1,
    })
    const [provisionalTask] = await mem.select<{
      template_snapshot_json: string
    }>(`
      SELECT template_snapshot_json
      FROM schedule_tasks
      WHERE group_id = ? AND name = ?
    `, [groupId, waterproof.name])
    expect(JSON.parse(provisionalTask!.template_snapshot_json)).toMatchObject({
      key: waterproof.key,
      provisionalFloorPlans: [
        {
          floorId: 'f2',
          itemId: 'i-wp-wall',
          provisionalQty: 12.5,
          unitCount: 1,
        },
        {
          floorId: 'f2',
          itemId: 'i-wp-floor',
          provisionalQty: 8,
          unitCount: 1,
        },
      ],
    })
    const provisionalAutomaticTask = store.snapshot!.groups[0]!.tasks
      .find(task => task.name === waterproof.name)!
    expect(provisionalAutomaticTask.floorPlans).toEqual([
      expect.objectContaining({
        floorId: 'f2',
        itemId: 'i-wp-wall',
        boqLineId: null,
        sourceBasis: 'provisional',
        provisionalQty: 12.5,
      }),
      expect.objectContaining({
        floorId: 'f2',
        itemId: 'i-wp-floor',
        boqLineId: null,
        sourceBasis: 'provisional',
        provisionalQty: 8,
      }),
    ])
    expect(await mem.select(`
      SELECT plan.floor_id,
             plan.item_id,
             plan.boq_line_id,
             plan.source_basis,
             plan.provisional_qty
      FROM schedule_task_floor_plans AS plan
      JOIN schedule_tasks AS task ON task.id = plan.task_id
      WHERE task.group_id = ? AND task.name = ?
      ORDER BY plan.sort_order
    `, [groupId, waterproof.name])).toEqual([
      {
        floor_id: 'f2',
        item_id: 'i-wp-wall',
        boq_line_id: null,
        source_basis: 'provisional',
        provisional_qty: 12.5,
      },
      {
        floor_id: 'f2',
        item_id: 'i-wp-floor',
        boq_line_id: null,
        source_basis: 'provisional',
        provisional_qty: 8,
      },
    ])
    expect(await mem.select(`
      SELECT item_id, boq_line_id
      FROM task_item_map
      WHERE task_id = (
        SELECT id FROM schedule_tasks WHERE group_id = ? AND name = ?
      )
      ORDER BY item_id
    `, [groupId, waterproof.name])).toEqual([
      { item_id: 'i-wp-floor', boq_line_id: null },
      { item_id: 'i-wp-wall', boq_line_id: null },
    ])

    await mem.execute(`
      UPDATE schedule_process_library_tasks
      SET name = '全局库后续改名', duration_days = 99
      WHERE id = ?
    `, [settingOut.id])
    await store.loadProject('p1', '2026-07-01')
    expect(store.snapshot?.groups[0]!.tasks[0]).toMatchObject({
      name: '放线及新建墙体',
      durationDays: 9,
    })
  })

  it('内部暂估分组新增自动工序时逐栋校验暂估量覆盖', async () => {
    const store = useScheduleStore()
    await store.loadProcessLibraries()
    const libraryId = store.processLibraries[0]!.id
    await store.loadProcessLibraryTasks(libraryId)
    const settingOut = store.processTasks.find(task => task.key === 'setting-out')!
    const waterproof = store.processTasks.find(task => task.key === 'waterproof')!
    await mem.execute('INSERT INTO items (id, project_id, code, name, trade, unit) VALUES (\'i-other\', \'p1\', \'OTHER\', \'其他有效分项\', \'综合\', \'m\')')
    await addProvisionalBuilding('b1', 'f1', 'i-other')
    await mem.execute(`
      INSERT INTO house_type_templates (id, project_id, code, name)
      VALUES ('template-b2-add', 'p1', 'B-ADD', 'B户型')
    `)
    await mem.execute(`
      INSERT INTO rooms (id, template_id, code, name)
      VALUES ('room-b2-add', 'template-b2-add', 'whole', '整户')
    `)
    await mem.execute(`
      INSERT INTO units (id, floor_id, house_type_template_id, code, name)
      VALUES ('unit-b2-add', 'f2', 'template-b2-add', '101', '101户')
    `)
    await mem.execute(`
      INSERT INTO house_type_template_items
        (id, room_id, item_id, provisional_qty, sort_order)
      VALUES
        ('hti-b2-add-wall', 'room-b2-add', 'i-wp-wall', 12.5, 10),
        ('hti-b2-add-floor', 'room-b2-add', 'i-wp-floor', 8, 20)
    `)
    const groupId = await store.createGroup({
      projectId: 'p1',
      scopeBasis: 'provisional',
      contractId: null,
      processLibraryId: libraryId,
      name: '内部暂估·逐栋新增校验',
      buildingIds: ['b1', 'b2'],
      startDate: '2026-07-01',
      overlapMode: 'seq',
      tasks: [
        { templateKey: settingOut.key, enabled: true, durationDays: 5, anchorStart: null },
      ],
    }, '2026-07-01')

    await expect(store.addTask(groupId, {
      templateKey: waterproof.key,
      plannedStart: '2026-07-06',
    }, '2026-07-01')).rejects.toThrow(/1栋.*防水.*有效暂估量/)
    expect(store.snapshot!.groups[0]!.tasks).toHaveLength(1)
    expect(await mem.select<{ total: number }>(
      `SELECT COUNT(*) AS total FROM schedule_tasks WHERE group_id = ?`,
      [groupId],
    )).toEqual([{ total: 1 }])
  })

  it('甘特调期遇到 FS 冲突时只软禁用关系，日期修复后才允许恢复', async () => {
    const store = useScheduleStore()
    const settingOut = SCHEDULE_TASK_TEMPLATES.find(template => template.key === 'setting-out')!
    const waterproof = SCHEDULE_TASK_TEMPLATES.find(template => template.key === 'waterproof')!
    await store.createGroup({
      projectId: 'p1',
      contractId: 'contract-main',
      name: '拖拽验证组',
      buildingIds: ['b1'],
      startDate: '2026-07-01',
      overlapMode: 'seq',
      tasks: [
        { templateKey: settingOut.key, enabled: true, durationDays: 5, anchorStart: null },
        { templateKey: waterproof.key, enabled: true, durationDays: 5, anchorStart: null },
      ],
    }, '2026-07-01')

    const [predecessor, successor] = store.snapshot!.groups[0]!.tasks
    const dependency = store.snapshot!.dependencies.find(row => row.succId === successor!.id)!
    const preview = store.previewTaskReschedule(successor!.id, {
      plannedStart: '2026-07-03',
      plannedFinish: '2026-07-07',
    })
    expect(preview.conflicts.map(row => row.dependencyId)).toEqual([dependency.id])

    const result = await store.rescheduleTask(successor!.id, {
      plannedStart: '2026-07-03',
      plannedFinish: '2026-07-07',
    }, [dependency.id], '2026-07-01')
    expect(result.disabledDependencyLogIds).toHaveLength(1)
    expect(store.snapshot!.dependencies).toEqual([])
    expect(store.snapshot!.disabledDependencies).toEqual([
      expect.objectContaining({
        id: dependency.id,
        predId: predecessor!.id,
        succId: successor!.id,
        disabledReason: 'schedule-conflict',
        auditLogId: expect.any(String),
      }),
    ])
    await expect(store.restoreDependency(dependency.id, '2026-07-01'))
      .rejects
      .toThrow(/计划日期仍冲突/)

    await store.rescheduleTask(successor!.id, {
      plannedStart: '2026-07-06',
      plannedFinish: '2026-07-10',
    }, [], '2026-07-01')
    await mem.execute(
      `INSERT INTO task_dependencies
        (id, pred_id, succ_id, dependency_type, lag_days)
       VALUES ('active-other', ?, ?, 'FS', 0)`,
      [predecessor!.id, successor!.id],
    )
    await store.loadProject('p1', '2026-07-01')
    await expect(store.restoreDependency(dependency.id, '2026-07-01'))
      .rejects
      .toThrow(/已有其他前置关系/)
    await mem.execute(`UPDATE task_dependencies SET deleted_at = datetime('now') WHERE id = 'active-other'`)
    await store.loadProject('p1', '2026-07-01')
    await expect(store.restoreDependency(dependency.id, '2026-07-01')).resolves.toBeTruthy()
    expect(store.snapshot!.dependencies).toEqual([
      expect.objectContaining({ id: dependency.id }),
    ])
    await store.removeDependency(dependency.id, '2026-07-01')
    expect(store.snapshot!.disabledDependencies).toEqual([])
    const [manualDeleteLog] = await mem.select<{ operator: string }>(
      `SELECT operator
       FROM operation_logs
       WHERE table_name = 'task_dependencies'
         AND record_id = ?
         AND action = 'delete'
       ORDER BY rowid DESC
       LIMIT 1`,
      [dependency.id],
    )
    expect(manualDeleteLog?.operator).toBe('schedule:manual-remove')
  })

  it('建组保留并软禁用冲突前置关系，未置灰时拒绝错序日期', async () => {
    await addProvisionalBuilding('b2', 'f2', 'i-wp-wall')
    const store = useScheduleStore()
    await store.loadProcessLibraries()
    const libraryId = store.processLibraries[0]!.id
    await store.loadProcessLibraryTasks(libraryId)
    const [settingOut, plumbing] = store.processTasks

    await expect(store.createGroup({
      projectId: 'p1',
      scopeBasis: 'provisional',
      contractId: null,
      processLibraryId: libraryId,
      name: '未确认错序',
      buildingIds: ['b2'],
      startDate: '2026-07-01',
      overlapMode: 'seq',
      tasks: [
        {
          templateKey: settingOut!.key,
          enabled: true,
          durationDays: 5,
          anchorStart: '2026-07-05',
          predecessorKey: null,
          predecessorDisabled: false,
        },
        {
          templateKey: plumbing!.key,
          enabled: true,
          durationDays: 5,
          anchorStart: '2026-07-01',
          predecessorKey: settingOut!.key,
          predecessorDisabled: false,
        },
      ],
    }, '2026-07-01')).rejects.toThrow(/不能早于仍启用的前置工序/)

    await store.createGroup({
      projectId: 'p1',
      scopeBasis: 'provisional',
      contractId: null,
      processLibraryId: libraryId,
      name: '已确认置灰',
      buildingIds: ['b2'],
      startDate: '2026-07-01',
      overlapMode: 'seq',
      tasks: [
        {
          templateKey: settingOut!.key,
          enabled: true,
          durationDays: 5,
          anchorStart: '2026-07-05',
          predecessorKey: null,
          predecessorDisabled: false,
        },
        {
          templateKey: plumbing!.key,
          enabled: true,
          durationDays: 5,
          anchorStart: '2026-07-01',
          predecessorKey: settingOut!.key,
          predecessorDisabled: true,
        },
      ],
    }, '2026-07-01')

    expect(store.snapshot!.dependencies).toEqual([])
    expect(store.snapshot!.disabledDependencies).toEqual([
      expect.objectContaining({
        predId: store.snapshot!.groups[0]!.tasks[0]!.id,
        succId: store.snapshot!.groups[0]!.tasks[1]!.id,
        disabledReason: 'schedule-conflict',
      }),
    ])
    const [successor] = await mem.select<{ template_snapshot_json: string }>(`
      SELECT template_snapshot_json
      FROM schedule_tasks
      WHERE group_id = ? AND name = ?
    `, [store.snapshot!.groups[0]!.id, plumbing!.name])
    expect(JSON.parse(successor!.template_snapshot_json)).toMatchObject({
      predecessorKey: settingOut!.key,
      predecessorDisabled: true,
    })
  })

  it('依赖编辑只接受同组较早工序、合法 lag，且恢复会拦截循环', async () => {
    const store = useScheduleStore()
    const templates = SCHEDULE_TASK_TEMPLATES.slice(0, 3)
    await store.createGroup({
      projectId: 'p1',
      contractId: 'contract-main',
      name: '依赖验证组',
      buildingIds: ['b1'],
      startDate: '2026-07-01',
      overlapMode: 'seq',
      tasks: templates.map(template => ({
        templateKey: template.key,
        enabled: true,
        durationDays: 3,
        anchorStart: null,
      })),
    }, '2026-07-01')
    const [first, second, third] = store.snapshot!.groups[0]!.tasks

    await expect(store.updateDependency(first!.id, second!.id, 0, '2026-07-01'))
      .rejects
      .toThrow(/计划开始不得晚于/)
    await expect(store.updateDependency(third!.id, first!.id, 366, '2026-07-01'))
      .rejects
      .toThrow(/-365.*365/)

    const dependency = store.snapshot!.dependencies.find(row => row.succId === second!.id)!
    await store.rescheduleTask(second!.id, {
      plannedStart: '2026-07-02',
      plannedFinish: '2026-07-04',
    }, [dependency.id], '2026-07-01')
    await mem.execute(
      `INSERT INTO task_dependencies
        (id, pred_id, succ_id, dependency_type, lag_days)
       VALUES ('cycle-third-first', ?, ?, 'FS', 0)`,
      [third!.id, first!.id],
    )
    await store.loadProject('p1', '2026-07-01')
    await expect(store.restoreDependency(dependency.id, '2026-07-01'))
      .rejects
      .toThrow(/循环依赖/)
  })
})
