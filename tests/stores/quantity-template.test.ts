import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { softDelete } from '~/lib/db/soft-delete'
import {
  blankQuantityTemplateDraft,
  borrowedQuantityTemplateDraft,
  editableQuantityTemplateDraft,
} from '~/lib/quantity/template'
import { useNativeQuantityStore as useQuantityStore } from '~/stores/quantity-native'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb
let failNextSelect = false
let delayedSelectProjectId = ''
let delayedSelectGate: Promise<void> | null = null

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => {
    if (failNextSelect) {
      failNextSelect = false
      throw new Error('模拟刷新失败')
    }
    if (delayedSelectGate && params?.includes(delayedSelectProjectId))
      await delayedSelectGate
    return mem.select(sql, params)
  },
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
  failNextSelect = false
  delayedSelectProjectId = ''
  delayedSelectGate = null
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name, code) VALUES ('p1', '项目一', 'P1'), ('p2', '项目二', 'P2')`)
  await mem.execute(
    `INSERT INTO items (id, project_id, code, name, trade, unit)
     VALUES ('i-wall', 'p1', 'wall', '墙砖铺贴', '泥水工', '㎡'),
            ('i-floor', 'p1', 'floor', '地砖铺贴', '泥水工', '㎡'),
            ('i-other', 'p2', 'other', '其他项目分项', '泥水工', '㎡')`,
  )
  await mem.execute(`INSERT INTO house_type_templates (id, project_id, code, name) VALUES ('t1', 'p1', 'A', 'A户型')`)
  await mem.execute(
    `INSERT INTO rooms (id, template_id, code, name, sort_order)
     VALUES ('r-living', 't1', 'living', '客餐厅', 10)`,
  )
  await mem.execute(
    `INSERT INTO house_type_template_items
       (id, room_id, item_id, recognized_contract_qty, contract_qty, provisional_qty, field_formula, field_qty)
     VALUES ('line-wall', 'r-living', 'i-wall', 12, 13, 14, '2×3', 6)`,
  )
  await mem.execute(`INSERT INTO buildings (id, project_id, code, name) VALUES ('b1', 'p1', '1', '1栋')`)
  await mem.execute(`INSERT INTO floors (id, building_id, code, name) VALUES ('f1', 'b1', '1', '1层')`)
  await mem.execute(
    `INSERT INTO units (id, floor_id, house_type_template_id, code, name)
     VALUES ('u1', 'f1', 't1', '01', '101户')`,
  )
  setActivePinia(createPinia())
})

afterEach(() => mem.close())

describe('quantity store：户型模板唯一写路径', () => {
  it('未修改草稿不制造操作日志', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')

    const result = await store.saveTemplate(draft)

    expect(result.logIds).toEqual([])
    const [logs] = await mem.select<{ total: number }>('SELECT COUNT(*) AS total FROM operation_logs')
    expect(logs?.total).toBe(0)
  })

  it('提交成功后的刷新失败不伪装成保存回滚，并保留撤回句柄', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    draft.name = '已提交但待刷新'
    failNextSelect = true

    const result = await store.saveTemplate(draft)

    expect(result.logIds.length).toBeGreaterThan(0)
    expect(store.templateError).toContain('已保存，但刷新失败')
    expect(store.templateWorkspace).toBeNull()
    const [template] = await mem.select<{ name: string }>('SELECT name FROM house_type_templates WHERE id = ?', ['t1'])
    expect(template?.name).toBe('已提交但待刷新')
  })

  it('并发模板加载只采纳最新项目，旧请求不能提前清除 loading', async () => {
    const store = useQuantityStore()
    let release!: () => void
    delayedSelectProjectId = 'p1'
    delayedSelectGate = new Promise<void>((resolve) => {
      release = resolve
    })

    const oldRequest = store.loadTemplates('p1')
    await store.loadTemplates('p2')
    expect(store.templateWorkspace?.projectId).toBe('p2')
    expect(store.templateLoading).toBe(true)

    release()
    await oldRequest
    expect(store.templateWorkspace?.projectId).toBe('p2')
    expect(store.templateLoading).toBe(false)
  })

  it('事务内保存模板、稳定房间与三量，并让挂靠户立即读取最新值', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const workspace = store.templateWorkspace!
    expect(workspace.templates[0]).toMatchObject({ id: 't1', code: 'A', unitCount: 1 })

    const draft = editableQuantityTemplateDraft(workspace, 't1')
    draft.name = 'A1户型'
    draft.rooms.find(room => room.id === 'r-living')!.name = '客餐厅（改）'
    const wallIndex = draft.lines.findIndex(line => line.id === 'line-wall')
    const wall = { ...draft.lines[wallIndex]!, recognizedContractQty: 999 }
    draft.lines[wallIndex] = wall
    wall.contractQty = 15
    wall.fieldFormula = '客厅（2＋3）×4'
    draft.rooms.push({
      key: 'new-room-bedroom',
      id: null,
      code: 'bedroom',
      name: '主卧',
      kind: 'room',
      sortOrder: 20,
    })
    draft.lines.push({
      key: 'new-line-floor',
      id: null,
      roomKey: 'new-room-bedroom',
      itemId: 'i-floor',
      recognizedContractQty: null,
      contractQty: 8,
      provisionalQty: 9,
      fieldFormula: '主卧：2×4',
      fieldQty: null,
      note: '',
      sortOrder: 20,
    })

    await store.saveTemplate(draft)

    const [template] = await mem.select<{ name: string }>('SELECT name FROM house_type_templates WHERE id = ?', ['t1'])
    const [living] = await mem.select<{ name: string }>('SELECT name FROM rooms WHERE id = ?', ['r-living'])
    const [savedWall] = await mem.select<{
      recognized_contract_qty: number
      contract_qty: number
      field_formula: string
      field_qty: number
    }>('SELECT recognized_contract_qty, contract_qty, field_formula, field_qty FROM house_type_template_items WHERE id = ?', ['line-wall'])
    expect(template?.name).toBe('A1户型')
    expect(living?.name).toBe('客餐厅（改）')
    expect(savedWall).toEqual({
      recognized_contract_qty: 12,
      contract_qty: 15,
      field_formula: '客厅（2＋3）×4',
      field_qty: 20,
    })

    const [linkedUnit] = await mem.select<{ contract_qty: number }>(
      `SELECT hti.contract_qty
       FROM units u
       JOIN rooms r ON r.template_id = u.house_type_template_id
       JOIN house_type_template_items hti ON hti.room_id = r.id
       WHERE u.id = 'u1' AND hti.item_id = 'i-wall' AND hti.deleted_at IS NULL`,
    )
    expect(linkedUnit?.contract_qty).toBe(15)
    const [logs] = await mem.select<{ total: number }>('SELECT COUNT(*) AS total FROM operation_logs')
    expect(logs?.total).toBe(5)
  })

  it('任一现场算式非法时整份模板不部分提交，也不覆盖旧有效值', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    draft.name = '不应保存的名称'
    draft.lines[0]!.contractQty = 88
    draft.lines[0]!.fieldFormula = '2÷0'

    await expect(store.saveTemplate(draft)).rejects.toThrow('不能除以 0')

    const [template] = await mem.select<{ name: string }>('SELECT name FROM house_type_templates WHERE id = ?', ['t1'])
    const [line] = await mem.select<{ contract_qty: number, field_formula: string, field_qty: number }>(
      'SELECT contract_qty, field_formula, field_qty FROM house_type_template_items WHERE id = ?',
      ['line-wall'],
    )
    expect(template?.name).toBe('A户型')
    expect(line).toEqual({ contract_qty: 13, field_formula: '2×3', field_qty: 6 })
    const [logs] = await mem.select<{ total: number }>('SELECT COUNT(*) AS total FROM operation_logs')
    expect(logs?.total).toBe(0)
  })

  it('中途写入异常会回滚已插入的模板、分项与操作日志', async () => {
    const store = useQuantityStore()
    const draft = blankQuantityTemplateDraft('p1')
    draft.code = 'ROLLBACK'
    draft.name = '事务回滚验证'
    draft.newItems.push({
      key: 'rollback-item',
      code: 'rollback-item',
      name: '回滚分项',
      section: '',
      trade: '测试工种',
      unit: '项',
      sortOrder: 10,
    })
    draft.rooms.push({
      key: 'rollback-room',
      id: null,
      code: 'rollback-room',
      name: '回滚房间',
      kind: 'room',
      sortOrder: 10,
    })
    const execute = mem.execute
    mem.execute = async (sql, params = []) => {
      if (/INSERT INTO rooms\s/.test(sql))
        throw new Error('模拟房间写入失败')
      await execute(sql, params)
    }

    try {
      await expect(store.saveTemplate(draft)).rejects.toThrow('模拟房间写入失败')
    }
    finally {
      mem.execute = execute
    }

    const [templates] = await mem.select<{ total: number }>(`SELECT COUNT(*) AS total FROM house_type_templates WHERE code = 'ROLLBACK'`)
    const [items] = await mem.select<{ total: number }>(`SELECT COUNT(*) AS total FROM items WHERE code = 'rollback-item'`)
    const [logs] = await mem.select<{ total: number }>('SELECT COUNT(*) AS total FROM operation_logs')
    expect({ templates: templates?.total, items: items?.total, logs: logs?.total }).toEqual({ templates: 0, items: 0, logs: 0 })
  })

  it('借用模板产生独立快照；来源后改不联动复制件', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const copied = borrowedQuantityTemplateDraft(store.templateWorkspace!, 't1')
    copied.code = 'B'
    copied.name = 'B户型'

    // 点击借用后，来源即使被修改、软删，复制件仍保存当时草稿中的可编辑字段快照。
    await mem.execute(
      'UPDATE house_type_template_items SET recognized_contract_qty = ?, contract_qty = ?, field_formula = ?, field_qty = ? WHERE id = ?',
      [77, 99, '10×10', 100, 'line-wall'],
    )
    await softDelete(mem, 'house_type_templates', 't1')

    const { templateId: copiedId } = await store.saveTemplate(copied)
    const [copyHeader] = await mem.select<{ copied_from_template_id: string }>(
      'SELECT copied_from_template_id FROM house_type_templates WHERE id = ?',
      [copiedId],
    )
    expect(copyHeader?.copied_from_template_id).toBe('t1')

    const copiedRows = await mem.select<{ id: string, room_id: string, contract_qty: number }>(
      `SELECT hti.id, hti.room_id, hti.contract_qty
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       WHERE r.template_id = ? AND hti.deleted_at IS NULL`,
      [copiedId],
    )
    expect(copiedRows).toHaveLength(1)
    expect(copiedRows[0]).toMatchObject({ contract_qty: 13 })
    expect(copiedRows[0]?.id).not.toBe('line-wall')
    expect(copiedRows[0]?.room_id).not.toBe('r-living')

    const [copySnapshot] = await mem.select<{ contract_qty: number, field_qty: number, recognized_contract_qty: number }>(
      'SELECT contract_qty, field_qty, recognized_contract_qty FROM house_type_template_items WHERE id = ?',
      [copiedRows[0]!.id],
    )
    expect(copySnapshot).toEqual({ contract_qty: 13, field_qty: 6, recognized_contract_qty: 12 })
  })

  it('借用来源身份必须与物理来源行匹配，不能把识别原值挂到其他分项', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const copied = borrowedQuantityTemplateDraft(store.templateWorkspace!, 't1')
    copied.code = 'B'
    copied.name = 'B户型'
    copied.lines[0]!.itemId = 'i-floor'
    copied.lines[0]!.sourceItemId = 'i-floor'

    await expect(store.saveTemplate(copied)).rejects.toThrow('来源房间或分项不匹配')
    const [templates] = await mem.select<{ total: number }>(
      `SELECT COUNT(*) AS total FROM house_type_templates WHERE code = 'B' AND deleted_at IS NULL`,
    )
    expect(templates?.total).toBe(0)
  })

  it('没有 BOQ 时可在同一次模板保存中手工建立分项，并可整批撤回', async () => {
    const store = useQuantityStore()
    const draft = blankQuantityTemplateDraft('p1')
    draft.code = 'C'
    draft.name = 'C户型'
    draft.newItems.push({
      key: 'new-item-putty',
      code: 'putty',
      name: '第一遍腻子',
      section: '装饰装修',
      trade: '油漆工',
      unit: '㎡',
      sortOrder: 30,
    })
    draft.lines.push({
      key: 'new-line-putty',
      id: null,
      roomKey: 'new:whole-unit',
      itemId: 'new-item-putty',
      recognizedContractQty: 999,
      contractQty: 40,
      provisionalQty: 42,
      fieldFormula: '整户：8×5',
      fieldQty: null,
      note: '无清单，现场手工建立',
      sortOrder: 30,
    })

    const result = await store.saveTemplate(draft)
    const [item] = await mem.select<{ project_id: string }>('SELECT project_id FROM items WHERE code = ?', ['putty'])
    const [line] = await mem.select<{ recognized_contract_qty: number | null, field_qty: number }>(
      `SELECT hti.recognized_contract_qty, hti.field_qty
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       WHERE r.template_id = ?`,
      [result.templateId],
    )
    expect(item?.project_id).toBe('p1')
    expect(line).toEqual({ recognized_contract_qty: null, field_qty: 40 })

    await store.undoTemplateSave('p1', result.logIds)
    expect(store.templateWorkspace?.templates.some(template => template.id === result.templateId)).toBe(false)
    const [physicalTemplate] = await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM house_type_templates WHERE id = ?',
      [result.templateId],
    )
    expect(physicalTemplate?.deleted_at).toBeTruthy()
  })

  it('模板明细仍被个人责任范围引用时拒绝删除，避免范围静默扩大', async () => {
    await mem.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-1', '泥水班', '泥水工')`)
    await mem.execute(
      `INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
       VALUES ('assignment-1', 'u1', '泥水工', 'crew-1')`,
    )
    await mem.execute(
      `INSERT INTO unit_assignment_scopes (id, assignment_id, room_id, item_id)
       VALUES ('scope-1', 'assignment-1', 'r-living', 'i-wall')`,
    )
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    draft.lines = []

    await expect(store.saveTemplate(draft)).rejects.toThrow('仍被个人责任范围引用')
    const [line] = await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM house_type_template_items WHERE id = ?',
      ['line-wall'],
    )
    expect(line?.deleted_at).toBeNull()
  })

  it('既有房间编码作为稳定机器码不可修改', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    draft.rooms.find(room => room.id === 'r-living')!.code = 'living-renamed'

    await expect(store.saveTemplate(draft)).rejects.toThrow('房间编码创建后不能修改')
    const [room] = await mem.select<{ code: string }>('SELECT code FROM rooms WHERE id = ?', ['r-living'])
    expect(room?.code).toBe('living')
  })

  it('新分项 client key 不能冒充既有分项 id', async () => {
    const store = useQuantityStore()
    const draft = blankQuantityTemplateDraft('p1')
    draft.code = 'B'
    draft.name = 'B户型'
    draft.newItems.push({
      key: 'i-wall',
      code: 'fake-wall',
      name: '伪装分项',
      section: '',
      trade: '泥水工',
      unit: '㎡',
      sortOrder: 10,
    })

    await expect(store.saveTemplate(draft)).rejects.toThrow('草稿标识不能与既有分项身份重复')
    const [items] = await mem.select<{ total: number }>(`SELECT COUNT(*) AS total FROM items WHERE code = 'fake-wall'`)
    expect(items?.total).toBe(0)
  })

  it('旧撤回句柄遇到后续保存时整批拒绝，不覆盖新版本', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const first = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    first.name = '第一次保存'
    const firstResult = await store.saveTemplate(first)

    const second = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    second.name = '后续正式版本'
    await store.saveTemplate(second)

    await expect(store.undoTemplateSave('p1', firstResult.logIds)).rejects.toThrow('不能覆盖新版本')
    const [template] = await mem.select<{ name: string }>('SELECT name FROM house_type_templates WHERE id = ?', ['t1'])
    expect(template?.name).toBe('后续正式版本')
  })

  it('跨项目触发旧撤回时不覆盖当前项目 workspace', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    draft.name = '待跨项目撤回'
    const result = await store.saveTemplate(draft)

    await store.loadTemplates('p2')
    await store.undoTemplateSave('p1', result.logIds, false)

    expect(store.templateWorkspace?.projectId).toBe('p2')
    const [template] = await mem.select<{ name: string }>('SELECT name FROM house_type_templates WHERE id = ?', ['t1'])
    expect(template?.name).toBe('A户型')
  })

  it('旧批次新增分项已被后续模板引用时拒绝撤回，不静默吞掉下游', async () => {
    const store = useQuantityStore()
    const first = blankQuantityTemplateDraft('p1')
    first.code = 'B'
    first.name = 'B户型'
    first.newItems.push({
      key: 'new-item-putty',
      code: 'putty',
      name: '腻子',
      section: '',
      trade: '油漆工',
      unit: '㎡',
      sortOrder: 10,
    })
    first.lines.push({
      key: 'new-line-putty',
      id: null,
      roomKey: 'new:whole-unit',
      itemId: 'new-item-putty',
      recognizedContractQty: null,
      contractQty: 10,
      provisionalQty: null,
      fieldFormula: '2×5',
      fieldQty: null,
      note: '',
      sortOrder: 10,
    })
    const firstResult = await store.saveTemplate(first)
    const putty = store.templateWorkspace!.items.find(item => item.code === 'putty')!

    const second = blankQuantityTemplateDraft('p1')
    second.code = 'C'
    second.name = 'C户型'
    second.lines.push({
      key: 'reuse-putty',
      id: null,
      roomKey: 'new:whole-unit',
      itemId: putty.id,
      recognizedContractQty: null,
      contractQty: 20,
      provisionalQty: null,
      fieldFormula: '4×5',
      fieldQty: null,
      note: '',
      sortOrder: 10,
    })
    const secondResult = await store.saveTemplate(second)

    await expect(store.undoTemplateSave('p1', firstResult.logIds)).rejects.toThrow('已被后续业务引用')
    const rows = await mem.select<{ template_id: string, item_deleted: string | null, line_deleted: string | null }>(
      `SELECT r.template_id, i.deleted_at AS item_deleted, hti.deleted_at AS line_deleted
       FROM house_type_template_items hti
       JOIN rooms r ON r.id = hti.room_id
       JOIN items i ON i.id = hti.item_id
       WHERE r.template_id IN (?, ?) AND i.id = ?
       ORDER BY r.template_id`,
      [firstResult.templateId, secondResult.templateId, putty.id],
    )
    expect(rows).toHaveLength(2)
    expect(rows.every(row => row.item_deleted == null && row.line_deleted == null)).toBe(true)
  })

  it('新增模板明细已进入个人责任范围时拒绝旧撤回', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    draft.lines.push({
      key: 'new-floor-line',
      id: null,
      roomKey: 'r-living',
      itemId: 'i-floor',
      recognizedContractQty: null,
      contractQty: 8,
      provisionalQty: null,
      fieldFormula: '2×4',
      fieldQty: null,
      note: '',
      sortOrder: 20,
    })
    const result = await store.saveTemplate(draft)
    const [newLine] = await mem.select<{ id: string }>(
      `SELECT id FROM house_type_template_items
       WHERE room_id = 'r-living' AND item_id = 'i-floor' AND deleted_at IS NULL`,
    )
    await mem.execute(`INSERT INTO crews (id, name, trade) VALUES ('crew-2', '二班', '泥水工')`)
    await mem.execute(
      `INSERT INTO unit_assignments (id, unit_id, trade, crew_id)
       VALUES ('assignment-2', 'u1', '泥水工', 'crew-2')`,
    )
    await mem.execute(
      `INSERT INTO unit_assignment_scopes (id, assignment_id, room_id, item_id)
       VALUES ('scope-2', 'assignment-2', 'r-living', 'i-floor')`,
    )

    await expect(store.undoTemplateSave('p1', result.logIds)).rejects.toThrow('已被后续业务引用')
    const [line] = await mem.select<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM house_type_template_items WHERE id = ?',
      [newLine!.id],
    )
    expect(line?.deleted_at).toBeNull()
  })

  it('拒绝跨项目分项，并禁止删除仍有挂靠户的模板', async () => {
    const store = useQuantityStore()
    await store.loadTemplates('p1')
    const draft = editableQuantityTemplateDraft(store.templateWorkspace!, 't1')
    draft.lines[0]!.itemId = 'i-other'

    await expect(store.saveTemplate(draft)).rejects.toThrow('分项不属于当前项目')
    await expect(store.deleteTemplate('t1')).rejects.toThrow('仍挂靠 1 户')
    const [template] = await mem.select<{ deleted_at: string | null }>('SELECT deleted_at FROM house_type_templates WHERE id = ?', ['t1'])
    expect(template?.deleted_at).toBeNull()
  })
})
