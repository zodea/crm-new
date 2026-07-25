import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
})

afterEach(() => db.close())

describe('施工进度演示 seed', () => {
  it('为演示项目内置 22 道工序、楼栋范围、FS+lag 依赖、分项映射和楼层计划', async () => {
    await seedIfEmpty(db)

    const [group] = await db.select<{ id: string, task_count: number, building_count: number }>(`
      SELECT sg.id,
             COUNT(DISTINCT st.id) AS task_count,
             COUNT(DISTINCT sgb.building_id) AS building_count
      FROM schedule_groups sg
      LEFT JOIN schedule_tasks st ON st.group_id = sg.id AND st.deleted_at IS NULL
      LEFT JOIN schedule_group_buildings sgb ON sgb.group_id = sg.id AND sgb.deleted_at IS NULL
      WHERE sg.project_id = 'proj_demo_001' AND sg.deleted_at IS NULL
      GROUP BY sg.id
    `)
    expect(group.task_count).toBe(22)
    expect(group.building_count).toBe(2)

    const automaticTasks = await db.select<{ stage_id: string | null, manual_progress: number | null }>(`
      SELECT stage_id, manual_progress
      FROM schedule_tasks
      WHERE project_id = 'proj_demo_001' AND has_qty = 1 AND deleted_at IS NULL
    `)
    expect(automaticTasks.length).toBeGreaterThan(0)
    expect(automaticTasks.every(task => task.stage_id && task.manual_progress == null)).toBe(true)

    const manualTasks = await db.select<{ stage_id: string | null, manual_progress: number | null }>(`
      SELECT stage_id, manual_progress
      FROM schedule_tasks
      WHERE project_id = 'proj_demo_001' AND has_qty = 0 AND deleted_at IS NULL
    `)
    expect(manualTasks.length).toBeGreaterThan(0)
    expect(manualTasks.every(task => task.stage_id == null && task.manual_progress != null)).toBe(true)

    const [dependency] = await db.select<{ dependency_type: string, lag_days: number }>(`
      SELECT dependency_type, lag_days
      FROM task_dependencies
      WHERE deleted_at IS NULL AND lag_days <> 0
      LIMIT 1
    `)
    expect(dependency.dependency_type).toBe('FS')
    expect(Number.isInteger(dependency.lag_days)).toBe(true)
    expect(await db.select(`SELECT id FROM task_item_map WHERE deleted_at IS NULL`))
      .not
      .toHaveLength(0)
    const floorPlans = await db.select<{
      planned_start: string
      planned_finish: string
      is_manual: number
    }>(`
      SELECT planned_start, planned_finish, is_manual
      FROM schedule_task_floor_plans
      WHERE deleted_at IS NULL
    `)
    expect(floorPlans.length).toBeGreaterThan(0)
    expect(floorPlans.every(plan =>
      plan.planned_finish >= plan.planned_start && plan.is_manual === 0,
    )).toBe(true)
    expect(await db.select<Record<string, unknown>>('PRAGMA foreign_key_check')).toEqual([])
  })

  it('重复 seed 不复制排程数据', async () => {
    await seedIfEmpty(db)
    const before = await db.select<{ total: number }>(`
      SELECT COUNT(*) AS total FROM schedule_task_floor_plans
    `)

    await seedIfEmpty(db)

    expect(await db.select<{ total: number }>(`
      SELECT COUNT(*) AS total FROM schedule_task_floor_plans
    `)).toEqual(before)
  })
})
