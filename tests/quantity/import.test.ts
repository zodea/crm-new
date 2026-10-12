import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { softDelete } from '~/lib/db/soft-delete'
import { loadQuantityAssignmentWorkspace, persistQuantityAssignments } from '~/lib/quantity/assignment'
import { persistQuantityStageCompletion } from '~/lib/quantity/completion'
import {
  buildQuantityAssignmentImportDraft,
  buildQuantityCompletionImportDraft,
  buildQuantityTemplateImportDraft,
  precheckQuantityLegacyRow,
} from '~/lib/quantity/import'
import { persistQuantityTemplate } from '~/lib/quantity/template'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let mem: TestDb

type Row = Record<string, unknown>
const text = (row: Row, key: string) => String(row[key] ?? '')
async function projectIdOf(row: Row) {
  const [project] = await mem.select<{ id: string }>('SELECT id FROM projects WHERE deleted_at IS NULL AND code = ?', [text(row, 'projectCode')])
  return project!.id
}
async function unitIdOf(projectId: string, row: Row) {
  const [unit] = await mem.select<{ id: string }>(`SELECT u.id FROM units u
    JOIN floors f ON f.id = u.floor_id
    JOIN buildings b ON b.id = f.building_id
    WHERE u.deleted_at IS NULL AND f.deleted_at IS NULL AND b.deleted_at IS NULL
      AND b.project_id = ? AND b.code = ? AND f.code = ? AND u.code = ?`, [projectId, text(row, 'buildingCode'), text(row, 'floorCode'), text(row, 'unitCode')])
  return unit!.id
}

/** 逐行导入的草稿构造与持久组合，与中央导入共用同一组 build/persist。 */
async function importQuantityTemplateRow(db: TestDb, row: Row) {
  await persistQuantityTemplate(db, await buildQuantityTemplateImportDraft(db, await projectIdOf(row), row))
}
async function importQuantityAssignmentRow(db: TestDb, row: Row) {
  const projectId = await projectIdOf(row)
  await persistQuantityAssignments(db, await buildQuantityAssignmentImportDraft(db, projectId, await unitIdOf(projectId, row), row))
}
async function importQuantityCompletionRow(db: TestDb, row: Row) {
  const projectId = await projectIdOf(row)
  await persistQuantityStageCompletion(db, { ...await buildQuantityCompletionImportDraft(db, projectId, await unitIdOf(projectId, row), row), allowMissingPhotos: true })
}

beforeEach(async () => {
  mem = await createMigratedMemoryDb()
  await mem.execute(`INSERT INTO projects (id, name, code) VALUES ('p1', '项目一', 'P1')`)
  await mem.execute(`INSERT INTO buildings (id, project_id, code, name, sort_order) VALUES
    ('b1', 'p1', '1', '1栋', 10)`)
  await mem.execute(`INSERT INTO floors (id, building_id, code, name, sort_order) VALUES
    ('f1', 'b1', '1', '1层', 10)`)
  await mem.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('t1', 'p1', 'A', 'A户型')`)
  await mem.execute(`INSERT INTO units (id, floor_id, house_type_template_id, code, sort_order) VALUES
    ('u1', 'f1', 't1', '01', 10)`)
  await mem.execute(`INSERT INTO items (id, project_id, code, name, trade, unit, sort_order) VALUES
    ('i-wall', 'p1', 'wall', '墙砖', '泥水工', '㎡', 10)`)
  await mem.execute(`INSERT INTO construction_stages
    (id, project_id, code, name, trade, completion_mode, sort_order) VALUES
    ('s-wall', 'p1', 'wall', '墙砖铺贴', '泥水工', 'unit', 20)`)
  await mem.execute(`INSERT INTO construction_stage_items (id, stage_id, item_id) VALUES
    ('map-wall', 's-wall', 'i-wall')`)
  await mem.execute(`INSERT INTO crews (id, name, trade) VALUES
    ('crew-a', '泥水一班', '泥水工'),
    ('crew-b', '泥水二班', '泥水工')`)
})

afterEach(() => mem.close())

describe('quantity import：三类目标逐行复用唯一写路径', () => {
  it('模板量导入可新建户型/房间/分项；手工通道不落识别原值，二次导入更新既有行', async () => {
    await importQuantityTemplateRow(mem, {
      projectCode: 'P1',
      templateCode: 'B',
      templateName: 'B户型',
      roomCode: 'living',
      roomName: '客餐厅',
      itemCode: 'floor',
      itemName: '地砖',
      trade: '泥水工',
      unit: '㎡',
      contractQty: '30',
      provisionalQty: '31',
      fieldFormula: '5×6',
    })

    const [line] = await mem.select<Record<string, unknown>>(
      `SELECT hti.recognized_contract_qty, hti.contract_qty, hti.provisional_qty, hti.field_qty, r.name AS room_name, i.name AS item_name
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       JOIN house_type_templates ht ON ht.id = r.template_id
       JOIN items i ON i.id = hti.item_id
       WHERE ht.code = 'B' AND hti.deleted_at IS NULL`,
    )
    expect(line).toMatchObject({
      recognized_contract_qty: null,
      contract_qty: 30,
      provisional_qty: 31,
      field_qty: 30,
      room_name: '客餐厅',
      item_name: '地砖',
    })

    await importQuantityTemplateRow(mem, {
      projectCode: 'P1',
      templateCode: 'B',
      roomCode: 'living',
      itemCode: 'floor',
      contractQty: '32',
    })
    const [updated] = await mem.select<Record<string, unknown>>(
      `SELECT hti.contract_qty, COUNT(*) OVER () AS total
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       JOIN house_type_templates ht ON ht.id = r.template_id
       WHERE ht.code = 'B' AND hti.deleted_at IS NULL`,
    )
    expect(updated).toMatchObject({ contract_qty: 32, total: 1 })
  })

  it('责任导入按名称匹配班组；替换现有责任必须行内显式声明，历史软删保留', async () => {
    await importQuantityAssignmentRow(mem, {
      projectCode: 'P1',
      buildingCode: '1',
      floorCode: '1',
      unitCode: '01',
      trade: '泥水工',
      crewName: '泥水一班',
    })
    // 未声明替换：不同责任静默覆盖被拒（ADR 0010 冲突保护）。
    await expect(importQuantityAssignmentRow(mem, {
      projectCode: 'P1',
      buildingCode: '1',
      floorCode: '1',
      unitCode: '01',
      trade: '泥水工',
      crewName: '泥水二班',
    })).rejects.toThrow('允许替换现有责任')

    await importQuantityAssignmentRow(mem, {
      projectCode: 'P1',
      buildingCode: '1',
      floorCode: '1',
      unitCode: '01',
      trade: '泥水工',
      crewName: '泥水二班',
      replaceExisting: '是',
    })

    expect(await mem.select(
      `SELECT crew_id FROM unit_assignments WHERE unit_id = 'u1' AND deleted_at IS NULL`,
    )).toEqual([{ crew_id: 'crew-b' }])
    expect(await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM unit_assignments WHERE unit_id = 'u1' AND deleted_at IS NOT NULL`,
    )).toEqual([{ n: 1 }])
  })

  it('重复导入同一名个人责任时保留既有房间分项范围', async () => {
    await mem.execute(`INSERT INTO workers (id, crew_id, name, trade) VALUES
      ('worker-a', 'crew-a', '张师傅', '泥水工')`)
    await mem.execute(`INSERT INTO house_type_template_items
      (id, room_id, item_id, contract_qty) VALUES
      ('line-wall', 't1:whole_unit', 'i-wall', 20)`)
    await mem.execute(`INSERT INTO unit_assignments
      (id, unit_id, trade, worker_id, note) VALUES
      ('assignment-worker', 'u1', '泥水工', 'worker-a', '保留范围')`)
    await mem.execute(`INSERT INTO unit_assignment_scopes
      (id, assignment_id, room_id, item_id) VALUES
      ('scope-wall', 'assignment-worker', 't1:whole_unit', 'i-wall')`)

    await importQuantityAssignmentRow(mem, {
      projectCode: 'P1',
      buildingCode: '1',
      floorCode: '1',
      unitCode: '01',
      trade: '泥水工',
      workerName: '张师傅',
    })

    const workspace = await loadQuantityAssignmentWorkspace(mem, 'p1')
    expect(workspace.assignments).toEqual([
      expect.objectContaining({
        id: 'assignment-worker',
        assigneeId: 'worker-a',
        scopes: [expect.objectContaining({ roomId: 't1:whole_unit', itemId: 'i-wall' })],
      }),
    ])
  })

  it('既有个人范围失效时必须显式替换，确认后清理失效范围', async () => {
    await mem.execute(`INSERT INTO workers (id, crew_id, name, trade) VALUES
      ('worker-invalid', 'crew-a', '李师傅', '泥水工')`)
    await mem.execute(`INSERT INTO house_type_template_items
      (id, room_id, item_id, contract_qty) VALUES
      ('line-invalid', 't1:whole_unit', 'i-wall', 20)`)
    await mem.execute(`INSERT INTO unit_assignments
      (id, unit_id, trade, worker_id) VALUES
      ('assignment-invalid', 'u1', '泥水工', 'worker-invalid')`)
    await mem.execute(`INSERT INTO unit_assignment_scopes
      (id, assignment_id, room_id, item_id) VALUES
      ('scope-invalid', 'assignment-invalid', 't1:whole_unit', 'i-wall')`)
    await softDelete(mem, 'house_type_template_items', 'line-invalid')

    const row = {
      projectCode: 'P1',
      buildingCode: '1',
      floorCode: '1',
      unitCode: '01',
      trade: '泥水工',
      workerName: '李师傅',
    }
    await expect(importQuantityAssignmentRow(mem, row)).rejects.toThrow('既有责任范围已失效')

    await importQuantityAssignmentRow(mem, { ...row, replaceExisting: '是' })
    const workspace = await loadQuantityAssignmentWorkspace(mem, 'p1')
    expect(workspace.assignments).toEqual([
      expect.objectContaining({
        assigneeId: 'worker-invalid',
        scopes: [],
        hasInvalidScopes: false,
      }),
    ])
  })

  it('阶段完成导入走历史迁移通道：无照片仍可 completed 并写执行责任审计', async () => {
    await mem.execute(`INSERT INTO house_type_template_items
      (id, room_id, item_id, contract_qty) VALUES
      ('line-wall-completion', 't1:whole_unit', 'i-wall', 20)`)
    await importQuantityAssignmentRow(mem, {
      projectCode: 'P1',
      buildingCode: '1',
      floorCode: '1',
      unitCode: '01',
      trade: '泥水工',
      crewName: '泥水一班',
    })
    await importQuantityCompletionRow(mem, {
      projectCode: 'P1',
      buildingCode: '1',
      floorCode: '1',
      unitCode: '01',
      stageCode: 'wall',
      status: '已完成',
      completedAt: '2026-05-18',
      note: '红圈迁移',
    })

    const [completion] = await mem.select<Record<string, unknown>>(
      `SELECT usc.status, usc.completed_at, usc.note, ua.crew_id
       FROM unit_stage_completions usc
       JOIN unit_assignments ua ON ua.id = usc.assignment_id
       WHERE usc.unit_id = 'u1' AND usc.stage_id = 's-wall'`,
    )
    expect(completion).toMatchObject({
      status: 'completed',
      completed_at: '2026-05-18',
      note: '红圈迁移',
      crew_id: 'crew-a',
    })
  })

  it('旧合一行预检只校验不写库：可迁移行通过，无阶段工种与不唯一户被拒', async () => {
    await expect(precheckQuantityLegacyRow(mem, {
      projectCode: 'P1',
      unitCode: '01',
      trade: '泥水工',
      completionMonth: '2026-05',
      quantity: '27.5',
    })).resolves.toBeUndefined()

    await expect(precheckQuantityLegacyRow(mem, {
      projectCode: 'P1',
      unitCode: '01',
      trade: '油工',
    })).rejects.toThrow('没有按户完成的工序阶段')

    await mem.execute(`INSERT INTO buildings (id, project_id, code, name, sort_order) VALUES
      ('b2', 'p1', '2', '2栋', 20)`)
    await mem.execute(`INSERT INTO floors (id, building_id, code, name, sort_order) VALUES
      ('f2', 'b2', '1', '1层', 10)`)
    await mem.execute(`INSERT INTO units (id, floor_id, house_type_template_id, code, sort_order) VALUES
      ('u2', 'f2', 't1', '01', 10)`)
    await expect(precheckQuantityLegacyRow(mem, {
      projectCode: 'P1',
      unitCode: '01',
      trade: '泥水工',
    })).rejects.toThrow('不唯一')

    expect(await mem.select('SELECT id FROM unit_stage_completions')).toEqual([])
    expect(await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM operation_logs`,
    )).toEqual([{ n: expect.any(Number) }])
  })
})
