import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { softDelete } from '~/lib/db/soft-delete'
import {
  loadQuantityConstructionRecords,
  loadQuantityMonthlyOutput,
  loadQuantityStageProgress,
} from '~/lib/quantity/derived'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name, code) VALUES ('p1', '项目一', 'P1')`)
  await mem.execute(`INSERT INTO buildings (id, project_id, code, name, sort_order) VALUES
    ('b1', 'p1', '1', '1栋', 10)`)
  await mem.execute(`INSERT INTO floors (id, building_id, code, name, sort_order) VALUES
    ('f1', 'b1', '1', '1层', 10)`)
  await mem.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('t1', 'p1', 'A', 'A户型'),
    ('t2', 'p1', 'B', 'B户型')`)
  await mem.execute(`INSERT INTO rooms (id, template_id, code, name, kind, sort_order) VALUES
    ('r1', 't1', 'living', '客餐厅', 'room', 10),
    ('r2', 't2', 'living', '客餐厅', 'room', 10)`)
  await mem.execute(`INSERT INTO items (id, project_id, code, name, trade, unit, sort_order) VALUES
    ('i-wall', 'p1', 'wall', '墙砖', '泥水工', '㎡', 10),
    ('i-floor', 'p1', 'floor', '地砖', '泥水工', '㎡', 11),
    ('i-putty', 'p1', 'putty', '墙面腻子', '油工', '㎡', 12)`)
  await mem.execute(`INSERT INTO house_type_template_items
    (id, room_id, item_id, contract_qty, provisional_qty, field_qty, sort_order) VALUES
    ('line-wall', 'r1', 'i-wall', 21, 22, 20, 10),
    ('line-floor', 'r1', 'i-floor', 12, 13, 11, 11),
    ('line-putty', 'r1', 'i-putty', 40, 41, 42, 12),
    ('line-wall-b', 'r2', 'i-wall', 30, 31, 32, 10)`)
  await mem.execute(`INSERT INTO units
    (id, floor_id, house_type_template_id, code, name, sort_order) VALUES
    ('u1', 'f1', 't1', '01', '101户', 10),
    ('u2', 'f1', 't1', '02', '102户', 11),
    ('u3', 'f1', 't2', '03', '103户', 12)`)
  await mem.execute(`INSERT INTO construction_stages
    (id, project_id, code, name, trade, completion_mode, sort_order) VALUES
    ('s-wall', 'p1', 'wall', '墙砖铺贴', '泥水工', 'unit', 20),
    ('s-floor', 'p1', 'floor', '地砖铺贴', '泥水工', 'unit', 21),
    ('s-putty', 'p1', 'putty', '一遍腻子', '油工', 'unit', 10),
    ('s-manual', 'p1', 'manual', '人工进度', '其他', 'manual', 90)`)
  await mem.execute(`INSERT INTO construction_stage_items
    (id, stage_id, item_id, is_reporting_stage) VALUES
    ('map-wall', 's-wall', 'i-wall', 1),
    ('map-floor', 's-floor', 'i-floor', 1),
    ('map-putty', 's-putty', 'i-putty', 1)`)
  await mem.execute(`INSERT INTO crews (id, name, trade) VALUES
    ('crew-masonry', '泥水一班', '泥水工'),
    ('crew-paint', '油工一班', '油工')`)
  await mem.execute(`INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES
    ('a-u1-m', 'u1', '泥水工', 'crew-masonry'),
    ('a-u2-m', 'u2', '泥水工', 'crew-masonry'),
    ('a-u1-p', 'u1', '油工', 'crew-paint')`)
  await mem.execute(`INSERT INTO unit_stage_completions
    (id, unit_id, stage_id, assignment_id, status, completed_at, note) VALUES
    ('c1', 'u1', 's-wall', 'a-u1-m', 'completed', '2026-06-15', NULL),
    ('c2', 'u2', 's-wall', 'a-u2-m', 'completed', '2026-07-02', NULL),
    ('c3', 'u3', 's-wall', NULL, 'draft', '2026-07-03', '待补责任'),
    ('c4', 'u1', 's-floor', 'a-u1-m', 'completed', '2026-07-05', NULL),
    ('c5', 'u1', 's-putty', 'a-u1-p', 'completed', '2026-06-20', NULL)`)
  await mem.execute(`INSERT INTO file_refs
    (id, owner_type, owner_id, file_name, file_size, category, mime_type) VALUES
    ('ph1', 'unit_stage_completion', 'c1', '墙砖1.jpg', 3, 'acceptance_photo', 'image/jpeg'),
    ('ph2', 'unit_stage_completion', 'c1', '墙砖2.jpg', 3, 'acceptance_photo', 'image/jpeg'),
    ('ph3', 'delivery_record', 'c1', '伪装.jpg', 3, 'acceptance_photo', 'image/jpeg')`)
  await mem.execute(`INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES
    ('ph1', 'base64', 'AQID'),
    ('ph2', 'base64', 'AQID'),
    ('ph3', 'base64', 'AQID')`)
})

afterEach(() => mem.close())

describe('quantity derived：统一派生读 seam', () => {
  it('阶段进度：应做户数按模板明细、完成/草稿分计、manual 阶段排除', async () => {
    const progress = await loadQuantityStageProgress(mem, 'p1')

    expect(progress.map(stage => stage.stageId)).toEqual(['s-putty', 's-wall', 's-floor'])
    expect(progress.find(stage => stage.stageId === 's-wall')).toMatchObject({
      stageName: '墙砖铺贴',
      trade: '泥水工',
      applicableUnits: 3,
      completedUnits: 2,
      draftUnits: 1,
    })
    // u3 挂 B 户型：无地砖明细，不计入应做。
    expect(progress.find(stage => stage.stageId === 's-floor')).toMatchObject({
      applicableUnits: 2,
      completedUnits: 1,
      draftUnits: 0,
    })
    expect(progress.find(stage => stage.stageId === 's-putty')).toMatchObject({
      applicableUnits: 2,
      completedUnits: 1,
    })
  })

  it('分项软删后从进度分母和月度量中隐藏，但不吞历史完成事实', async () => {
    await softDelete(mem, 'items', 'i-floor')

    const progress = await loadQuantityStageProgress(mem, 'p1')
    expect(progress.find(stage => stage.stageId === 's-floor')).toMatchObject({
      applicableUnits: 0,
      completedUnits: 1,
    })

    const monthly = await loadQuantityMonthlyOutput(mem, 'p1')
    expect(monthly.some(row => row.stageId === 's-floor')).toBe(false)

    const records = await loadQuantityConstructionRecords(mem, 'p1')
    expect(records.some(record => record.completionId === 'c4')).toBe(true)
  })

  it('施工记录：工种→阶段→日期排序，执行责任按审计保留，照片随可见完成事实计数', async () => {
    await softDelete(mem, 'unit_assignments', 'a-u1-m')

    const records = await loadQuantityConstructionRecords(mem, 'p1')
    expect(records.map(record => record.completionId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(records.find(record => record.completionId === 'c1')).toMatchObject({
      unitName: '101户',
      floorName: '1层',
      buildingName: '1栋',
      stageName: '墙砖铺贴',
      trade: '泥水工',
      status: 'completed',
      completedAt: '2026-06-15',
      executionAssigneeName: '泥水一班',
      currentAssigneeName: null,
      photoCount: 2,
    })
    expect(records.find(record => record.completionId === 'c3')).toMatchObject({
      executionAssigneeName: null,
      note: '待补责任',
    })

    const filtered = await loadQuantityConstructionRecords(mem, 'p1', { crewId: 'crew-paint' })
    expect(filtered.map(record => record.completionId)).toEqual(['c5'])

    await softDelete(mem, 'unit_stage_completions', 'c1')
    const afterHide = await loadQuantityConstructionRecords(mem, 'p1')
    expect(afterHide.some(record => record.completionId === 'c1')).toBe(false)
  })

  it('月度完成量：completed 按月聚合三量，draft 不计入', async () => {
    const monthly = await loadQuantityMonthlyOutput(mem, 'p1')

    expect(monthly.map(row => `${row.month}:${row.stageId}`)).toEqual([
      '2026-06:s-putty',
      '2026-06:s-wall',
      '2026-07:s-wall',
      '2026-07:s-floor',
    ])
    expect(monthly.find(row => row.month === '2026-06' && row.stageId === 's-wall')).toMatchObject({
      trade: '泥水工',
      completedUnits: 1,
      contractQty: 21,
      provisionalQty: 22,
      fieldQty: 20,
    })
    expect(monthly.find(row => row.month === '2026-07' && row.stageId === 's-wall')).toMatchObject({
      completedUnits: 1,
      contractQty: 21,
    })
    expect(monthly.some(row => row.stageId === 's-floor' && row.month === '2026-06')).toBe(false)
  })

  it('月度完成量只在显式报量阶段计一次，多阶段共用分项不重复带量', async () => {
    await mem.execute(`INSERT INTO construction_stages
      (id, project_id, code, name, trade, completion_mode, sort_order) VALUES
      ('s-putty-final', 'p1', 'putty-final', '二遍腻子', '油工', 'unit', 11)`)
    await mem.execute(`UPDATE construction_stage_items
      SET is_reporting_stage = 0 WHERE id = 'map-putty'`)
    await mem.execute(`INSERT INTO construction_stage_items
      (id, stage_id, item_id, is_reporting_stage) VALUES
      ('map-putty-final', 's-putty-final', 'i-putty', 1)`)
    await mem.execute(`INSERT INTO unit_stage_completions
      (id, unit_id, stage_id, assignment_id, status, completed_at) VALUES
      ('c6', 'u1', 's-putty-final', 'a-u1-p', 'completed', '2026-06-25')`)

    const monthly = await loadQuantityMonthlyOutput(mem, 'p1')
    const putty = monthly.filter(row => row.trade === '油工')

    expect(putty).toEqual([
      expect.objectContaining({
        month: '2026-06',
        stageId: 's-putty-final',
        completedUnits: 1,
        contractQty: 40,
        provisionalQty: 41,
        fieldQty: 42,
      }),
    ])
  })
})
