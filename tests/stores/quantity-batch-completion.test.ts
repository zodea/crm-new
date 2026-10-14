import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadQuantityBatchCompletionPlan,
  persistQuantityBatchCompletion,
} from '~/lib/quantity/batch-completion'
import { useNativeQuantityStore as useQuantityStore } from '~/stores/quantity-native'
import { createMigratedMemoryDb } from '../helpers/memory-db'

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
  mem = await createMigratedMemoryDb()
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
    ('i-floor', 'p1', 'floor', '地砖', '泥水工', '㎡', 11)`)
  await mem.execute(`INSERT INTO house_type_template_items
    (id, room_id, item_id, contract_qty, field_qty, sort_order) VALUES
    ('line-wall', 'r1', 'i-wall', 21, 20, 10),
    ('line-floor', 'r1', 'i-floor', 12, 11, 11),
    ('line-wall-b', 'r2', 'i-wall', 30, 30, 10)`)
  await mem.execute(`INSERT INTO units
    (id, floor_id, house_type_template_id, code, name, sort_order) VALUES
    ('u1', 'f1', 't1', '01', '101户', 10),
    ('u2', 'f1', 't1', '02', '102户', 11),
    ('u3', 'f1', 't2', '03', '103户', 12)`)
  await mem.execute(`INSERT INTO construction_stages
    (id, project_id, code, name, trade, completion_mode, sort_order) VALUES
    ('s-wall', 'p1', 'wall', '墙砖铺贴', '泥水工', 'unit', 20),
    ('s-floor', 'p1', 'floor', '地砖铺贴', '泥水工', 'unit', 21)`)
  await mem.execute(`INSERT INTO construction_stage_items (id, stage_id, item_id) VALUES
    ('map-wall', 's-wall', 'i-wall'),
    ('map-floor', 's-floor', 'i-floor')`)
  await mem.execute(`INSERT INTO crews (id, name, trade) VALUES
    ('crew-masonry', '泥水一班', '泥水工')`)
  await mem.execute(`INSERT INTO unit_assignments (id, unit_id, trade, crew_id) VALUES
    ('a-u1', 'u1', '泥水工', 'crew-masonry'),
    ('a-u2', 'u2', '泥水工', 'crew-masonry')`)
  // u1 墙砖已完成（带照片）；u2 墙砖有带照片草稿；其余未登记。
  await mem.execute(`INSERT INTO unit_stage_completions
    (id, unit_id, stage_id, assignment_id, status, completed_at) VALUES
    ('done-u1-wall', 'u1', 's-wall', 'a-u1', 'completed', '2026-07-01'),
    ('draft-u2-wall', 'u2', 's-wall', 'a-u2', 'draft', '2026-07-02')`)
  await mem.execute(`INSERT INTO file_refs
    (id, owner_type, owner_id, file_name, file_size, category, mime_type) VALUES
    ('ph-u1-wall', 'unit_stage_completion', 'done-u1-wall', 'u1墙砖.jpg', 3, 'acceptance_photo', 'image/jpeg'),
    ('ph-u2-wall', 'unit_stage_completion', 'draft-u2-wall', 'u2墙砖.jpg', 3, 'acceptance_photo', 'image/jpeg')`)
  await mem.execute(`INSERT INTO file_payloads (file_ref_id, encoding, content) VALUES
    ('ph-u1-wall', 'base64', 'AQID'),
    ('ph-u2-wall', 'base64', 'AQID')`)
  setActivePinia(createPinia())
})

afterEach(() => mem.close())

describe('quantity batch completion：整工种批量展开与逐阶段写入', () => {
  it('计划展开为户×阶段列项：带当前状态、照片与责任预判、目标结果预告', async () => {
    const plan = await loadQuantityBatchCompletionPlan(mem, 'p1', {
      trade: '泥水工',
      unitIds: ['u1', 'u2', 'u3'],
    })

    expect(plan.trade).toBe('泥水工')
    expect(plan.matrixArchivedAt).toBeNull()
    expect(plan.items.map(item => `${item.unitId}:${item.stageId}`)).toEqual([
      'u1:s-wall',
      'u1:s-floor',
      'u2:s-wall',
      'u2:s-floor',
      'u3:s-wall',
    ])
    // u3 挂 B 户型：模板只有墙砖明细，地砖阶段不适用，不出现在计划里。
    expect(plan.items.find(item => item.unitId === 'u3' && item.stageId === 's-floor')).toBeUndefined()

    expect(plan.items.find(item => item.unitId === 'u1' && item.stageId === 's-wall')).toMatchObject({
      unitName: '101户',
      stageName: '墙砖铺贴',
      currentStatus: 'completed',
      hasPhotos: true,
      assigneeName: '泥水一班',
      projectedStatus: 'completed',
      projectedReason: null,
    })
    expect(plan.items.find(item => item.unitId === 'u2' && item.stageId === 's-wall')).toMatchObject({
      currentStatus: 'draft',
      hasPhotos: true,
      projectedStatus: 'completed',
      projectedReason: null,
    })
    expect(plan.items.find(item => item.unitId === 'u2' && item.stageId === 's-floor')).toMatchObject({
      currentStatus: null,
      hasPhotos: false,
      projectedStatus: 'draft',
      projectedReason: 'missing-photo',
    })
    expect(plan.items.find(item => item.unitId === 'u3' && item.stageId === 's-wall')).toMatchObject({
      assigneeName: null,
      projectedStatus: 'draft',
      projectedReason: 'missing-assignment',
    })
  })

  it('提交逐阶段落事实：有照片转完成、缺照片存草稿、无变化跳过，结果按阶段回显', async () => {
    const plan = await loadQuantityBatchCompletionPlan(mem, 'p1', {
      trade: '泥水工',
      unitIds: ['u1', 'u2', 'u3'],
    })
    const selected = plan.items.filter(item => !(item.unitId === 'u1' && item.stageId === 's-wall'))

    const store = useQuantityStore()
    await store.loadProject('p1')
    const result = await store.saveBatchCompletion({
      projectId: 'p1',
      trade: '泥水工',
      completedAt: '2026-07-20',
      note: '泥水工批量收尾',
      items: selected.map(item => ({
        unitId: item.unitId,
        stageId: item.stageId,
        expectedCompletionId: item.expectedCompletionId,
        expectedCompletionFingerprint: item.expectedCompletionFingerprint,
        expectedAssignmentId: item.expectedAssignmentId,
      })),
      allowArchivedEdit: false,
    })

    expect(result.completed.map(item => `${item.unitId}:${item.stageId}`)).toEqual(['u2:s-wall'])
    expect(result.drafted.map(item => `${item.unitId}:${item.stageId}`)).toEqual([
      'u1:s-floor',
      'u2:s-floor',
      'u3:s-wall',
    ])
    expect(result.drafted.map(item => item.reason)).toEqual([
      'missing-photo',
      'missing-photo',
      'missing-assignment',
    ])
    expect(result.unchanged).toEqual([])

    expect(await mem.select(
      `SELECT unit_id, stage_id, status, completed_at, note
       FROM unit_stage_completions
       WHERE deleted_at IS NULL
       ORDER BY unit_id, stage_id`,
    )).toEqual([
      { unit_id: 'u1', stage_id: 's-floor', status: 'draft', completed_at: '2026-07-20', note: '泥水工批量收尾' },
      { unit_id: 'u1', stage_id: 's-wall', status: 'completed', completed_at: '2026-07-01', note: null },
      { unit_id: 'u2', stage_id: 's-floor', status: 'draft', completed_at: '2026-07-20', note: '泥水工批量收尾' },
      { unit_id: 'u2', stage_id: 's-wall', status: 'completed', completed_at: '2026-07-20', note: '泥水工批量收尾' },
      { unit_id: 'u3', stage_id: 's-wall', status: 'draft', completed_at: '2026-07-20', note: '泥水工批量收尾' },
    ])
    // 批量转完成写执行责任审计；草稿允许无责任。
    expect(await mem.select(
      `SELECT assignment_id FROM unit_stage_completions WHERE unit_id = 'u2' AND stage_id = 's-wall'`,
    )).toEqual([{ assignment_id: 'a-u2' }])
    expect(store.snapshot?.completions.some(item => item.unitId === 'u2' && item.stageId === 's-wall' && item.status === 'completed')).toBe(true)
  })

  it('并发保护：计划过期时整体拒绝且不落任何行', async () => {
    const plan = await loadQuantityBatchCompletionPlan(mem, 'p1', {
      trade: '泥水工',
      unitIds: ['u1', 'u2'],
    })
    const items = plan.items
      .filter(item => item.currentStatus == null)
      .map(item => ({
        unitId: item.unitId,
        stageId: item.stageId,
        expectedCompletionId: item.expectedCompletionId,
        expectedCompletionFingerprint: item.expectedCompletionFingerprint,
        expectedAssignmentId: item.expectedAssignmentId,
      }))
    await mem.execute(`INSERT INTO unit_stage_completions
      (id, unit_id, stage_id, assignment_id, status, completed_at)
      VALUES ('sneak', 'u1', 's-floor', 'a-u1', 'completed', '2026-07-19')`)

    await expect(persistQuantityBatchCompletion(mem, {
      projectId: 'p1',
      trade: '泥水工',
      completedAt: '2026-07-20',
      note: '',
      items,
      allowArchivedEdit: false,
    })).rejects.toThrow('已发生变化')
    expect(await mem.select(
      `SELECT COUNT(*) AS n FROM unit_stage_completions WHERE completed_at = '2026-07-20'`,
    )).toEqual([{ n: 0 }])
  })

  it('归档矩阵拒绝批量写入，显式授权后放行', async () => {
    await mem.execute(`UPDATE projects SET matrix_archived_at = '2026-07-19' WHERE id = 'p1'`)
    const plan = await loadQuantityBatchCompletionPlan(mem, 'p1', {
      trade: '泥水工',
      unitIds: ['u2'],
    })
    const items = plan.items
      .filter(item => item.stageId === 's-floor')
      .map(item => ({
        unitId: item.unitId,
        stageId: item.stageId,
        expectedCompletionId: item.expectedCompletionId,
        expectedCompletionFingerprint: item.expectedCompletionFingerprint,
        expectedAssignmentId: item.expectedAssignmentId,
      }))

    const draft = {
      projectId: 'p1',
      trade: '泥水工',
      completedAt: '2026-07-20',
      note: '',
      items,
      allowArchivedEdit: false,
    }
    await expect(persistQuantityBatchCompletion(mem, draft)).rejects.toThrow('已归档')
    const result = await persistQuantityBatchCompletion(mem, { ...draft, allowArchivedEdit: true })
    expect(result.drafted).toHaveLength(1)
  })
})
