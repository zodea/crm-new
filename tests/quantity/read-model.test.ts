import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadQuantityCatalog, loadQuantityProjectSnapshot } from '~/lib/quantity/read-model'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)

  await db.execute(`INSERT INTO projects (id, name, code) VALUES ('p1', '项目一', 'P1'), ('p2', '项目二', 'P2')`)
  await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-old', '原泥水班', '泥水工')`)
  await db.execute(`INSERT INTO buildings (id, project_id, code, name) VALUES ('b1', 'p1', '1', '1栋'), ('b2', 'p2', '2', '2栋')`)
  await db.execute(`INSERT INTO floors (id, building_id, code, name) VALUES ('f1', 'b1', '1', '1层'), ('f2', 'b2', '1', '1层')`)
  await db.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES ('t1', 'p1', 'A', 'A户型'), ('t2', 'p2', 'A', 'A户型')`)
  await db.execute(`INSERT INTO units (id, floor_id, house_type_template_id, code, name) VALUES ('u1', 'f1', 't1', '01', '101户'), ('u2', 'f2', 't2', '01', '101户')`)
  await db.execute(`INSERT INTO construction_stages (id, project_id, code, name, trade) VALUES ('s1', 'p1', 'wall', '墙砖铺贴', '泥水工'), ('s2', 'p2', 'floor', '地砖铺贴', '泥水工')`)
  await db.execute(`INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES ('a-old', 'u1', '泥水工', 'crew-old')`)
  await db.execute(
    `INSERT INTO unit_stage_completions (id, unit_id, stage_id, assignment_id, status, completed_at)
     VALUES
       ('done-right', 'u1', 's1', 'a-old', 'completed', '2026-05-01T08:00:00.000Z'),
       ('done-cross-project', 'u1', 's2', 'a-old', 'completed', '2026-06-01T08:00:00.000Z')`,
  )
  await db.execute(`UPDATE unit_assignments SET deleted_at = '2026-06-02T00:00:00.000Z' WHERE id = 'a-old'`)
})

afterEach(() => db.close())

describe('工程量只读查询', () => {
  it('目录标出有区域数据的项目', async () => {
    const catalog = await loadQuantityCatalog(db)

    expect(catalog).toEqual([
      { id: 'p1', code: 'P1', name: '项目一', hasQuantityData: true },
      { id: 'p2', code: 'P2', name: '项目二', hasQuantityData: true },
    ])
  })

  it('按项目隔离户与阶段，跨项目阶段不得串入矩阵', async () => {
    const result = await loadQuantityProjectSnapshot(db, 'p1')

    expect(result.units.map(unit => unit.id)).toEqual(['u1'])
    expect(result.stages.map(stage => stage.id)).toEqual(['s1'])
    expect(result.completions.map(completion => completion.id)).toEqual(['done-right'])
  })

  it('当前责任走可见集，历史完成仍物理关联已替换责任身份', async () => {
    const result = await loadQuantityProjectSnapshot(db, 'p1')

    expect(result.assignments).toEqual([])
    expect(result.completions[0]).toMatchObject({
      assignmentId: 'a-old',
      assigneeKind: 'crew',
      assigneeId: 'crew-old',
      assigneeName: '原泥水班',
    })
  })

  it('审计责任不属于同一户与工种时不把其他项目身份串入完成记录', async () => {
    await db.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-other', '项目二泥水班', '泥水工')`)
    await db.execute(`INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES ('a-other', 'u2', '泥水工', 'crew-other')`)
    await db.execute(`UPDATE unit_stage_completions SET assignment_id = 'a-other' WHERE id = 'done-right'`)

    const result = await loadQuantityProjectSnapshot(db, 'p1')
    expect(result.completions.find(row => row.id === 'done-right')).toMatchObject({
      assigneeKind: null,
      assigneeId: null,
      assigneeName: '未记录执行责任',
    })
  })

  it('楼栋祖先软删后整条区域与完成事实从读模型隐藏', async () => {
    await db.execute(`UPDATE buildings SET deleted_at = '2026-06-03T00:00:00.000Z' WHERE id = 'b1'`)

    const result = await loadQuantityProjectSnapshot(db, 'p1')
    expect(result.buildings).toEqual([])
    expect(result.floors).toEqual([])
    expect(result.units).toEqual([])
    expect(result.completions).toEqual([])
  })
})
