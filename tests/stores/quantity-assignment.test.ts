import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { softDelete } from '~/lib/db/soft-delete'
import {
  quantityAssigneeIsCandidate,
  quantityAssigneeRequiresDetailedScope,
  quantityAssignmentFingerprint,
} from '~/lib/quantity/assignment'
import { useNativeQuantityStore as useQuantityStore } from '~/stores/quantity-native'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb
const OLD_ASSIGNMENT_FINGERPRINT = quantityAssignmentFingerprint(
  'crew',
  'crew-old',
  '完成时原责任',
  [],
)

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
  await mem.execute(`INSERT INTO projects (id, name, code) VALUES
    ('p1', '项目一', 'P1'),
    ('p2', '项目二', 'P2')`)
  await mem.execute(`INSERT INTO buildings (id, project_id, code, name, sort_order) VALUES
    ('b1', 'p1', '1', '1栋', 10),
    ('b2', 'p2', '2', '2栋', 10)`)
  await mem.execute(`INSERT INTO floors (id, building_id, code, name, sort_order) VALUES
    ('f1', 'b1', '1', '1层', 10),
    ('f2', 'b1', '2', '2层', 20),
    ('f3', 'b2', '1', '1层', 10)`)
  await mem.execute(`INSERT INTO items (id, project_id, code, name, trade, unit) VALUES
    ('i-wall', 'p1', 'wall', '墙砖', '泥水工', '㎡'),
    ('i-floor', 'p1', 'floor', '地砖', '泥水工', '㎡'),
    ('i-water', 'p1', 'water', '给水管', '水暖工', 'm'),
    ('i-other', 'p2', 'other', '跨项目墙砖', '泥水工', '㎡')`)
  await mem.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES
    ('t1', 'p1', 'A', 'A户型'),
    ('t2', 'p1', 'B', 'B户型'),
    ('t3', 'p2', 'A', '外项目户型')`)
  await mem.execute(`INSERT INTO rooms (id, template_id, code, name, kind, sort_order) VALUES
    ('r1', 't1', 'living', '客餐厅', 'room', 10),
    ('r2', 't2', 'kitchen', '厨房', 'room', 10),
    ('r3', 't3', 'other', '外项目房间', 'room', 10)`)
  await mem.execute(`INSERT INTO house_type_template_items
    (id, room_id, item_id, contract_qty, sort_order) VALUES
    ('line-1', 'r1', 'i-wall', 12, 10),
    ('line-2', 'r1', 'i-water', 8, 20),
    ('line-3', 'r2', 'i-floor', 9, 10),
    ('line-4', 'r3', 'i-other', 7, 10)`)
  await mem.execute(`INSERT INTO units
    (id, floor_id, house_type_template_id, code, name, sort_order) VALUES
    ('u1', 'f1', 't1', '01', '101户', 10),
    ('u2', 'f1', 't1', '02', '102户', 20),
    ('u4', 'f2', 't2', '01', '201户', 10),
    ('u3', 'f3', 't3', '01', '外项目101户', 10)`)
  await mem.execute(`INSERT INTO construction_stages
    (id, project_id, code, name, trade, sort_order) VALUES
    ('s-wall', 'p1', 'wall', '墙砖铺贴', '泥水工', 10),
    ('s-water', 'p1', 'water', '给水安装', '水暖工', 20),
    ('s-other', 'p2', 'other', '外项目墙砖', '泥水工', 10)`)
  await mem.execute(`INSERT INTO crews (id, name, trade) VALUES
    ('crew-old', '原泥水班', '泥水工'),
    ('crew-new', '新泥水班', '泥水工'),
    ('crew-water', '水电班', '水暖工')`)
  await mem.execute(`INSERT INTO workers (id, crew_id, name, trade) VALUES
    ('worker-new', 'crew-new', '张师傅', '泥水工'),
    ('worker-water', 'crew-water', '周师傅', '水暖工')`)
  await mem.execute(`INSERT INTO unit_assignments
    (id, unit_id, trade, crew_id, note) VALUES
    ('a-old', 'u1', '泥水工', 'crew-old', '完成时原责任')`)
  await mem.execute(`INSERT INTO unit_stage_completions
    (id, unit_id, stage_id, assignment_id, status, completed_at) VALUES
    ('done-old', 'u1', 's-wall', 'a-old', 'completed', '2026-06-01T08:00:00.000Z')`)
  setActivePinia(createPinia())
})

afterEach(() => mem.close())

function assignmentDraft(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'p1',
    trade: '泥水工',
    assigneeKind: 'crew' as const,
    assigneeId: 'crew-new',
    unitIds: ['u2'],
    expectedAssignments: [{ unitId: 'u2', assignmentId: null, fingerprint: null }],
    scopes: [],
    allowReplacement: false,
    ...overrides,
  }
}

describe('quantity store：户×工种责任配置唯一写路径', () => {
  it('加载按楼层分组的户、班组/个人与稳定房间分项范围', async () => {
    const store = useQuantityStore()

    await store.loadAssignments('p1')

    expect(store.assignmentWorkspace?.units.map(unit => unit.id)).toEqual(['u1', 'u2', 'u4'])
    expect(store.assignmentWorkspace?.trades).toEqual(['泥水工', '水暖工'])
    expect(store.assignmentWorkspace?.assignees.map(assignee => assignee.id).sort()).toEqual([
      'crew-new',
      'crew-old',
      'crew-water',
      'worker-new',
      'worker-water',
    ].sort())
    expect(store.assignmentWorkspace?.assignees.map(assignee => assignee.kind)).toEqual([
      'crew',
      'crew',
      'crew',
      'worker',
      'worker',
    ])
    expect(store.assignmentWorkspace?.scopeOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ templateId: 't1', roomId: 'r1', itemId: 'i-wall', trade: '泥水工' }),
      expect.objectContaining({ templateId: 't2', roomId: 'r2', itemId: 'i-floor', trade: '泥水工' }),
    ]))
    expect(store.assignmentWorkspace?.assignments).toEqual([
      expect.objectContaining({ id: 'a-old', unitId: 'u1', assigneeId: 'crew-old', scopes: [] }),
    ])
  })

  it('候选按多工种与活项能力过滤，存量单一 trade 仍兼容', async () => {
    await mem.execute(`
      INSERT INTO crews (
        id, name, trade, trade_capabilities, item_capabilities
      ) VALUES
        ('crew-cross', '跨工种班组', '木工', '["木工","泥水工"]', '[]'),
        ('crew-partial', '仅墙砖班组', '泥水工', '["泥水工"]', '["墙砖"]')
    `)
    await mem.execute(`
      INSERT INTO workers (
        id, name, trade, trade_capabilities, item_capabilities
      ) VALUES (
        'worker-partial', '墙砖师傅', '油漆工', '["油漆工","泥水工"]', '["墙砖"]'
      )
    `)
    const store = useQuantityStore()
    await store.loadAssignments('p1')
    const source = store.assignmentWorkspace!
    const mudItems = source.scopeOptions
      .filter(option => option.trade === '泥水工')
      .map(option => option.itemName)
    const byId = new Map(source.assignees.map(assignee => [assignee.id, assignee]))

    expect(quantityAssigneeIsCandidate(byId.get('crew-old')!, '泥水工', mudItems)).toBe(true)
    expect(quantityAssigneeIsCandidate(byId.get('crew-cross')!, '泥水工', mudItems)).toBe(true)
    expect(quantityAssigneeIsCandidate(byId.get('crew-partial')!, '泥水工', mudItems)).toBe(false)
    expect(quantityAssigneeIsCandidate(byId.get('worker-partial')!, '泥水工', mudItems)).toBe(true)
    expect(quantityAssigneeRequiresDetailedScope(
      byId.get('worker-partial')!,
      '泥水工',
      mudItems,
    )).toBe(true)
  })

  it('保存前再次拒绝不兼容责任人以及部分活项人员的整工种责任', async () => {
    await mem.execute(`
      INSERT INTO workers (
        id, name, trade, trade_capabilities, item_capabilities
      ) VALUES (
        'worker-partial', '墙砖师傅', '泥水工', '["泥水工"]', '["墙砖"]'
      )
    `)
    const store = useQuantityStore()

    await expect(store.saveAssignments(assignmentDraft({
      assigneeKind: 'worker',
      assigneeId: 'worker-water',
    }))).rejects.toThrow('能力与当前工种或活项不兼容')
    await expect(store.saveAssignments(assignmentDraft({
      assigneeKind: 'worker',
      assigneeId: 'worker-partial',
    }))).rejects.toThrow('必须指定房间分项范围')
  })

  it('批量指派逐户落日志，且不写任何阶段完成字段', async () => {
    const store = useQuantityStore()
    await store.loadProject('p1')
    const before = await mem.select('SELECT * FROM unit_stage_completions ORDER BY id')

    const result = await store.saveAssignments(assignmentDraft({
      unitIds: ['u2', 'u4'],
      expectedAssignments: [
        { unitId: 'u2', assignmentId: null, fingerprint: null },
        { unitId: 'u4', assignmentId: null, fingerprint: null },
      ],
    }))

    expect(result.changedUnitIds).toEqual(['u2', 'u4'])
    expect(result.replacedUnitIds).toEqual([])
    expect(await mem.select('SELECT * FROM unit_stage_completions ORDER BY id')).toEqual(before)
    const active = await mem.select<{ unit_id: string, crew_id: string }>(
      `SELECT unit_id, crew_id FROM unit_assignments
       WHERE deleted_at IS NULL AND unit_id IN ('u2', 'u4') ORDER BY unit_id`,
    )
    expect(active).toEqual([
      { unit_id: 'u2', crew_id: 'crew-new' },
      { unit_id: 'u4', crew_id: 'crew-new' },
    ])
    const logs = await mem.select<{ record_id: string, action: string }>(
      `SELECT record_id, action FROM operation_logs
       WHERE table_name = 'unit_assignments' ORDER BY rowid`,
    )
    expect(logs).toHaveLength(2)
    expect(logs.every(log => log.action === 'create')).toBe(true)
    expect(store.snapshot?.assignments.filter(row => ['u2', 'u4'].includes(row.unitId))).toHaveLength(2)
  })

  it('发现既有责任时必须显式确认；确认后软删旧责任且历史完成仍读旧身份', async () => {
    const store = useQuantityStore()
    const draft = assignmentDraft({
      unitIds: ['u1'],
      expectedAssignments: [{ unitId: 'u1', assignmentId: 'a-old', fingerprint: OLD_ASSIGNMENT_FINGERPRINT }],
    })

    await expect(store.saveAssignments(draft)).rejects.toThrow('确认替换')
    expect(await mem.select(
      `SELECT id, crew_id FROM unit_assignments WHERE unit_id = 'u1' AND deleted_at IS NULL`,
    )).toEqual([{ id: 'a-old', crew_id: 'crew-old' }])

    const result = await store.saveAssignments({ ...draft, allowReplacement: true })

    expect(result.replacedUnitIds).toEqual(['u1'])
    const physical = await mem.select<{ id: string, crew_id: string, deleted_at: string | null }>(
      `SELECT id, crew_id, deleted_at FROM unit_assignments WHERE unit_id = 'u1' ORDER BY created_at, rowid`,
    )
    expect(physical).toHaveLength(2)
    expect(physical[0]).toMatchObject({ id: 'a-old', crew_id: 'crew-old' })
    expect(physical[0]?.deleted_at).not.toBeNull()
    expect(physical[1]).toMatchObject({ crew_id: 'crew-new', deleted_at: null })
    expect(await mem.select(
      `SELECT assignment_id, status, completed_at FROM unit_stage_completions WHERE id = 'done-old'`,
    )).toEqual([{
      assignment_id: 'a-old',
      status: 'completed',
      completed_at: '2026-06-01T08:00:00.000Z',
    }])
    expect(store.snapshot?.completions[0]).toMatchObject({
      assignmentId: 'a-old',
      assigneeId: 'crew-old',
      assigneeName: '原泥水班',
    })
  })

  it('个人责任可下钻当前户型的房间×同工种分项，并逐范围落日志', async () => {
    const store = useQuantityStore()

    const result = await store.saveAssignments(assignmentDraft({
      assigneeKind: 'worker',
      assigneeId: 'worker-new',
      scopes: [{ unitId: 'u2', roomId: 'r1', itemId: 'i-wall' }],
    }))

    expect(result.logIds).toHaveLength(2)
    const [assignment] = await mem.select<{ id: string, worker_id: string }>(
      `SELECT id, worker_id FROM unit_assignments
       WHERE unit_id = 'u2' AND trade = '泥水工' AND deleted_at IS NULL`,
    )
    expect(assignment?.worker_id).toBe('worker-new')
    expect(await mem.select(
      `SELECT room_id, item_id FROM unit_assignment_scopes
       WHERE assignment_id = ? AND deleted_at IS NULL`,
      [assignment?.id],
    )).toEqual([{ room_id: 'r1', item_id: 'i-wall' }])
    expect(await mem.select<{ table_name: string }>(
      `SELECT table_name FROM operation_logs ORDER BY rowid`,
    )).toEqual([
      { table_name: 'unit_assignments' },
      { table_name: 'unit_assignment_scopes' },
    ])
  })

  it('同一责任与同一范围是 no-op；同一人改变范围也必须换行留史', async () => {
    const store = useQuantityStore()
    const unchanged = await store.saveAssignments(assignmentDraft({
      assigneeId: 'crew-old',
      unitIds: ['u1'],
      expectedAssignments: [{ unitId: 'u1', assignmentId: 'a-old', fingerprint: OLD_ASSIGNMENT_FINGERPRINT }],
    }))
    expect(unchanged).toMatchObject({
      changedUnitIds: [],
      unchangedUnitIds: ['u1'],
      replacedUnitIds: [],
      logIds: [],
    })

    await mem.execute(`INSERT INTO unit_assignments
      (id, unit_id, trade, worker_id) VALUES ('a-worker', 'u2', '泥水工', 'worker-new')`)
    await mem.execute(`INSERT INTO unit_assignment_scopes
      (id, assignment_id, room_id, item_id) VALUES ('scope-old', 'a-worker', 'r1', 'i-wall')`)
    await store.loadAssignments('p1')
    const current = store.assignmentWorkspace?.assignments.find(row => row.id === 'a-worker')

    await expect(store.saveAssignments(assignmentDraft({
      assigneeKind: 'worker',
      assigneeId: 'worker-new',
      expectedAssignments: [{
        unitId: 'u2',
        assignmentId: 'a-worker',
        fingerprint: current?.fingerprint ?? null,
      }],
      scopes: [],
    }))).rejects.toThrow('确认替换')

    const changed = await store.saveAssignments(assignmentDraft({
      assigneeKind: 'worker',
      assigneeId: 'worker-new',
      expectedAssignments: [{
        unitId: 'u2',
        assignmentId: 'a-worker',
        fingerprint: current?.fingerprint ?? null,
      }],
      scopes: [],
      allowReplacement: true,
    }))
    expect(changed.replacedUnitIds).toEqual(['u2'])
    expect(await mem.select<{ id: string, deleted_at: string | null }>(
      `SELECT id, deleted_at FROM unit_assignments WHERE unit_id = 'u2' ORDER BY rowid`,
    )).toEqual([
      expect.objectContaining({ id: 'a-worker', deleted_at: expect.any(String) }),
      expect.objectContaining({ deleted_at: null }),
    ])
    expect(await mem.select(
      `SELECT id FROM unit_assignment_scopes WHERE assignment_id = 'a-worker' AND deleted_at IS NULL`,
    )).toEqual([{ id: 'scope-old' }])
  })

  it('拒绝跨户型、跨工种或班组携带个人范围，且整批不产生半写入', async () => {
    const store = useQuantityStore()

    await expect(store.saveAssignments(assignmentDraft({
      assigneeKind: 'worker',
      assigneeId: 'worker-new',
      unitIds: ['u2', 'u4'],
      expectedAssignments: [
        { unitId: 'u2', assignmentId: null, fingerprint: null },
        { unitId: 'u4', assignmentId: null, fingerprint: null },
      ],
      scopes: [{ unitId: 'u4', roomId: 'r1', itemId: 'i-wall' }],
    }))).rejects.toThrow('户型')
    await expect(store.saveAssignments(assignmentDraft({
      assigneeKind: 'worker',
      assigneeId: 'worker-new',
      scopes: [{ unitId: 'u2', roomId: 'r1', itemId: 'i-water' }],
    }))).rejects.toThrow('工种')
    await expect(store.saveAssignments(assignmentDraft({
      scopes: [{ unitId: 'u2', roomId: 'r1', itemId: 'i-wall' }],
    }))).rejects.toThrow('个人责任')

    expect(await mem.select(
      `SELECT id FROM unit_assignments WHERE unit_id IN ('u2', 'u4') AND deleted_at IS NULL`,
    )).toEqual([])
    expect(await mem.select('SELECT id FROM operation_logs')).toEqual([])
  })

  it('保存前校验预期责任版本，拒绝用陈旧选择覆盖并发写入', async () => {
    const store = useQuantityStore()
    await store.loadAssignments('p1')
    await mem.execute(`INSERT INTO unit_assignments
      (id, unit_id, trade, crew_id) VALUES ('a-concurrent', 'u2', '泥水工', 'crew-old')`)

    await expect(store.saveAssignments(assignmentDraft())).rejects.toThrow('已发生变化')

    expect(await mem.select(
      `SELECT id, crew_id FROM unit_assignments WHERE unit_id = 'u2' AND deleted_at IS NULL`,
    )).toEqual([{ id: 'a-concurrent', crew_id: 'crew-old' }])
  })

  it('责任 ID 未变但备注或范围指纹变化时也拒绝陈旧确认', async () => {
    const store = useQuantityStore()
    await store.loadAssignments('p1')
    const current = store.assignmentWorkspace?.assignments.find(row => row.id === 'a-old')
    await mem.execute(`UPDATE unit_assignments SET note = '并发改备注' WHERE id = 'a-old'`)

    await expect(store.saveAssignments(assignmentDraft({
      unitIds: ['u1'],
      expectedAssignments: [{
        unitId: 'u1',
        assignmentId: 'a-old',
        fingerprint: current?.fingerprint ?? null,
      }],
      allowReplacement: true,
    }))).rejects.toThrow('责任范围已发生变化')

    expect(await mem.select(
      `SELECT id, note, deleted_at FROM unit_assignments WHERE id = 'a-old'`,
    )).toEqual([{ id: 'a-old', note: '并发改备注', deleted_at: null }])
  })

  it('责任人主数据缺失时仍显示物理冲突并可显式替换，不撞唯一键', async () => {
    const store = useQuantityStore()
    await mem.execute('PRAGMA foreign_keys = OFF')
    await mem.execute(`DELETE FROM crews WHERE id = 'crew-old'`)
    await mem.execute('PRAGMA foreign_keys = ON')
    await store.loadAssignments('p1')
    expect(store.assignmentWorkspace?.assignments.find(row => row.id === 'a-old')).toMatchObject({
      assigneeId: 'crew-old',
      assigneeName: '已删除班组',
    })

    const saved = await store.saveAssignments(assignmentDraft({
      unitIds: ['u1'],
      expectedAssignments: [{
        unitId: 'u1',
        assignmentId: 'a-old',
        fingerprint: OLD_ASSIGNMENT_FINGERPRINT,
      }],
      allowReplacement: true,
    }))

    expect(saved.replacedUnitIds).toEqual(['u1'])
    expect(await mem.select(
      `SELECT crew_id FROM unit_assignments
       WHERE unit_id = 'u1' AND trade = '泥水工' AND deleted_at IS NULL`,
    )).toEqual([{ crew_id: 'crew-new' }])
  })

  it('软删班组及其工人从候选隐藏，不能再成为新责任目标', async () => {
    const store = useQuantityStore()
    await softDelete(mem, 'crews', 'crew-new')

    await store.loadAssignments('p1')

    expect(store.assignmentWorkspace?.assignees.map(row => row.id)).not.toContain('crew-new')
    expect(store.assignmentWorkspace?.assignees.map(row => row.id)).not.toContain('worker-new')
    await expect(store.saveAssignments(assignmentDraft())).rejects.toThrow('责任人不存在')
    expect(await mem.select(
      `SELECT id FROM unit_assignments WHERE unit_id = 'u2' AND deleted_at IS NULL`,
    )).toEqual([])
  })

  it('旧责任人软删后仍显示物理冲突占位名，并可替换为可见责任人', async () => {
    const store = useQuantityStore()
    await softDelete(mem, 'crews', 'crew-old')
    await store.loadAssignments('p1')
    const current = store.assignmentWorkspace?.assignments.find(row => row.id === 'a-old')

    expect(current).toMatchObject({
      assigneeId: 'crew-old',
      assigneeName: '已删除班组',
    })
    expect(store.assignmentWorkspace?.assignees.map(row => row.id)).not.toContain('crew-old')

    const saved = await store.saveAssignments(assignmentDraft({
      unitIds: ['u1'],
      expectedAssignments: [{
        unitId: 'u1',
        assignmentId: 'a-old',
        fingerprint: current?.fingerprint ?? null,
      }],
      allowReplacement: true,
    }))
    expect(saved.replacedUnitIds).toEqual(['u1'])
  })

  it('跨项目或跨工种的遗留 scope 不暴露为有效范围，必须换行修复', async () => {
    const store = useQuantityStore()
    await mem.execute(`INSERT INTO unit_assignment_scopes
      (id, assignment_id, room_id, item_id) VALUES
      ('scope-cross-project', 'a-old', 'r3', 'i-other'),
      ('scope-cross-trade', 'a-old', 'r1', 'i-water')`)
    await store.loadAssignments('p1')
    const current = store.assignmentWorkspace?.assignments.find(row => row.id === 'a-old')

    expect(current).toMatchObject({ scopes: [], hasInvalidScopes: true })
    await expect(store.saveAssignments(assignmentDraft({
      assigneeId: 'crew-old',
      unitIds: ['u1'],
      expectedAssignments: [{
        unitId: 'u1',
        assignmentId: 'a-old',
        fingerprint: current?.fingerprint ?? null,
      }],
    }))).rejects.toThrow('确认替换')

    const repaired = await store.saveAssignments(assignmentDraft({
      assigneeId: 'crew-old',
      unitIds: ['u1'],
      expectedAssignments: [{
        unitId: 'u1',
        assignmentId: 'a-old',
        fingerprint: current?.fingerprint ?? null,
      }],
      allowReplacement: true,
    }))
    expect(repaired.replacedUnitIds).toEqual(['u1'])
    expect(store.assignmentWorkspace?.assignments.find(row => row.unitId === 'u1' && row.trade === '泥水工'))
      .toMatchObject({ scopes: [], hasInvalidScopes: false })
  })

  it('遗留坏 assignment 的孤儿工种只可显示，不得自举为新写入工种', async () => {
    const store = useQuantityStore()
    await mem.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-ghost', '幽灵班组', '幽灵工种')`)
    await mem.execute(`INSERT INTO unit_assignments
      (id, unit_id, trade, crew_id) VALUES ('a-ghost', 'u2', '幽灵工种', 'crew-ghost')`)
    await store.loadAssignments('p1')

    expect(store.assignmentWorkspace?.assignments.map(row => row.trade)).toContain('幽灵工种')
    expect(store.assignmentWorkspace?.trades).not.toContain('幽灵工种')
    await expect(store.saveAssignments(assignmentDraft({
      trade: '幽灵工种',
      assigneeId: 'crew-ghost',
      unitIds: ['u4'],
      expectedAssignments: [{ unitId: 'u4', assignmentId: null, fingerprint: null }],
    }))).rejects.toThrow('当前项目不存在该工种')
  })

  it('归档矩阵必须二次确认，确认标记也会在事务内复核', async () => {
    const store = useQuantityStore()
    await mem.execute(`UPDATE projects
      SET matrix_archived_at = '2026-07-20T10:00:00.000Z' WHERE id = 'p1'`)

    await expect(store.saveAssignments(assignmentDraft())).rejects.toThrow('已归档')
    const saved = await store.saveAssignments(assignmentDraft({ allowArchivedEdit: true }))

    expect(saved.changedUnitIds).toEqual(['u2'])
  })

  it('批量中途 SQL 失败时由 store transaction 回滚先前户及其日志', async () => {
    const store = useQuantityStore()
    await mem.execute(`CREATE TRIGGER fail_u4_assignment
      BEFORE INSERT ON unit_assignments
      WHEN NEW.unit_id = 'u4'
      BEGIN
        SELECT RAISE(ABORT, '模拟第二户写入失败');
      END`)

    await expect(store.saveAssignments(assignmentDraft({
      unitIds: ['u2', 'u4'],
      expectedAssignments: [
        { unitId: 'u2', assignmentId: null, fingerprint: null },
        { unitId: 'u4', assignmentId: null, fingerprint: null },
      ],
    }))).rejects.toThrow('模拟第二户写入失败')

    expect(await mem.select(
      `SELECT id FROM unit_assignments WHERE unit_id IN ('u2', 'u4') AND deleted_at IS NULL`,
    )).toEqual([])
    expect(await mem.select('SELECT id FROM operation_logs')).toEqual([])
  })
})
