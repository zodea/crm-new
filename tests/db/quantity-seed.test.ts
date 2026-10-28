import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedIfEmpty, seedQuantityDemo } from '~/lib/db/seed'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb

async function count(table: string): Promise<number> {
  const [row] = await db.select<{ total: number }>(`SELECT COUNT(*) AS total FROM "${table}"`)
  return row?.total ?? 0
}

async function insertDemoAncestors() {
  await db.execute(`INSERT INTO projects (id, name, code) VALUES ('proj_demo_001', '合和新城', 'HHXC-01')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew_demo_001', '泥水A班', '泥水工')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew_demo_002', '泥水B班', '泥水工')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew_demo_005', '防水班', '防水工')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew_demo_006', '水电班', '水暖工')`)
  await db.execute(`INSERT INTO workers (id, crew_id, name, trade) VALUES ('wkr_demo_003', 'crew_demo_001', '张建国', '泥水工')`)
}

beforeEach(async () => {
  db = await createMigratedMemoryDb()
})

afterEach(() => db.close())

describe('工程量演示 seed', () => {
  it('真实 seedIfEmpty 贯通两户型、三楼栋、多楼层、双泥水班组与跨月阶段完成', async () => {
    await seedIfEmpty(db)

    expect(await count('house_type_templates')).toBe(2)
    expect(await count('buildings')).toBe(3)
    expect(await count('floors')).toBeGreaterThanOrEqual(4)
    expect(await count('units')).toBeGreaterThanOrEqual(8)

    const roomKinds = await db.select<{ kind: string, total: number }>(
      'SELECT kind, COUNT(*) AS total FROM rooms GROUP BY kind ORDER BY kind',
    )
    expect(roomKinds).toContainEqual({ kind: 'whole_unit', total: 2 })
    expect(roomKinds.find(row => row.kind === 'room')?.total).toBeGreaterThan(0)

    const masonryCrews = await db.select<{ crew_id: string }>(
      `SELECT DISTINCT crew_id
       FROM unit_assignments
       WHERE trade = '泥水工' AND crew_id IS NOT NULL AND deleted_at IS NULL
       ORDER BY crew_id`,
    )
    expect(masonryCrews.map(row => row.crew_id)).toEqual(['crew_demo_001', 'crew_demo_002'])

    const months = await db.select<{ month: string }>(
      `SELECT DISTINCT substr(completed_at, 1, 7) AS month
       FROM unit_stage_completions
       WHERE status = 'completed'
       ORDER BY month`,
    )
    expect(months.length).toBeGreaterThanOrEqual(2)

    const foreignKeyViolations = await db.select<Record<string, unknown>>('PRAGMA foreign_key_check')
    expect(foreignKeyViolations).toEqual([])
  })

  it('户型触发器已写整户范围时仍补齐普通房间，并可重复收敛', async () => {
    await insertDemoAncestors()
    await db.execute(
      `INSERT INTO house_type_templates (id, project_id, code, name)
       VALUES ('qty_tpl_a', 'proj_demo_001', 'A', 'A户型')`,
    )
    expect(await count('rooms')).toBe(1)

    await seedQuantityDemo(db)
    const firstCounts = {
      templates: await count('house_type_templates'),
      rooms: await count('rooms'),
      completions: await count('unit_stage_completions'),
    }
    expect(firstCounts.templates).toBe(2)
    expect(firstCounts.rooms).toBeGreaterThan(2)
    expect(firstCounts.completions).toBeGreaterThan(0)

    await seedQuantityDemo(db)
    expect({
      templates: await count('house_type_templates'),
      rooms: await count('rooms'),
      completions: await count('unit_stage_completions'),
    }).toEqual(firstCounts)
  })

  it('旧库缺少演示祖先时安全跳过整组工程量数据', async () => {
    await seedQuantityDemo(db)

    expect(await count('items')).toBe(0)
    expect(await count('house_type_templates')).toBe(0)
    expect(await count('unit_stage_completions')).toBe(0)
  })
})
