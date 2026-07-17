import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { useDeliveryRecordStore } from '~/stores/delivery-record'
import { columnNames, createMemoryDb, listTables } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
}))

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  await mem.execute(`INSERT INTO projects (id, name) VALUES ('p1', '合和新城')`)
  await mem.execute(`INSERT INTO suppliers (id, name) VALUES ('s1', '广州市大板东建材有限公司')`)
  setActivePinia(createPinia())
})

describe('送货单 pass-1：版本化持久化', () => {
  it('冷启动后具备送货单头、明细表与必需字段', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)

    const tables = await listTables(db)
    expect(tables).toContain('delivery_records')
    expect(tables).toContain('delivery_lines')
    expect(await columnNames(db, 'delivery_records')).toEqual(expect.arrayContaining([
      'id',
      'project_id',
      'supplier_id',
      'order_no',
      'delivery_date',
      'file_name',
      'note',
      'created_at',
      'updated_at',
      'deleted_at',
    ]))
    expect(await columnNames(db, 'delivery_lines')).toEqual(expect.arrayContaining([
      'id',
      'delivery_record_id',
      'material_name',
      'spec',
      'unit',
      'qty',
      'unit_price',
      'amount',
      'sort_order',
      'deleted_at',
    ]))

    db.close()
  })

  it('新建底层记录默认留在待识别处理区，不自动冒充已归档', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p-default', '默认值项目')`)
    await db.execute(`INSERT INTO delivery_records (id, project_id) VALUES ('del-default', 'p-default')`)

    const [record] = await db.select<{ ocr_status: string, archived: number, stored: number }>(
      `SELECT ocr_status, archived, stored FROM delivery_records WHERE id = 'del-default'`,
    )
    expect(record).toEqual({ ocr_status: 'pending', archived: 0, stored: 0 })

    db.close()
  })
})

describe('送货单 pass-1：store CRUD 闭环', () => {
  it('新增后可从公开查询接口取回头字段、明细与金额', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-001',
      deliveryDate: '2026-07-15',
      note: '首车钢筋',
      lines: [
        { materialName: 'HRB400 螺纹钢', spec: 'Φ12', unit: '吨', qty: 2.5, unitPrice: 3800, note: '' },
        { materialName: '水泥', spec: 'P.O 42.5', unit: '吨', qty: 3, unitPrice: 420, note: '' },
      ],
    })

    expect(store.byId(id)).toMatchObject({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-001',
      ocrStatus: 'reviewed',
      archived: true,
      totalAmount: 10760,
    })
    expect(store.byId(id)?.lines.map(line => ({ name: line.materialName, amount: line.amount }))).toEqual([
      { name: 'HRB400 螺纹钢', amount: 9500 },
      { name: '水泥', amount: 1260 },
    ])
  })

  it('人工复核金额独立持久化，不在保存时被数量×单价覆盖', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-MANUAL-AMOUNT',
      deliveryDate: '2026-07-17',
      note: '特殊计价',
      lines: [{
        materialName: '特殊材料',
        spec: '',
        unit: '项',
        qty: 2,
        unitPrice: 100,
        amount: 175,
        note: '人工确认金额',
      }],
    })

    expect(store.byId(id)?.lines[0]?.amount).toBe(175)
    expect(store.byId(id)?.totalAmount).toBe(175)
  })

  it('编辑会整体替换明细，随后列表与详情读取同一份结果', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: null,
      orderNo: 'SH-002',
      deliveryDate: '2026-07-15',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 10, unitPrice: 80, note: '' }],
    })

    const logId = await store.update(id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-002A',
      deliveryDate: '2026-07-16',
      note: '复核后修改',
      lines: [{ materialName: '中砂', spec: '', unit: '方', qty: 12, unitPrice: 85, note: '' }],
    })

    expect(logId).toBeTruthy()
    expect(store.byId(id)).toMatchObject({ orderNo: 'SH-002A', supplierId: 's1', totalAmount: 1020 })
    expect(store.byId(id)?.lines).toHaveLength(1)
    expect(store.byId(id)?.lines[0]?.materialName).toBe('中砂')

    expect(await store.undo(logId!)).toBe(true)
    expect(store.byId(id)).toMatchObject({ orderNo: 'SH-002', supplierId: null, totalAmount: 800 })
    expect(store.byId(id)?.lines).toHaveLength(1)
    expect(store.byId(id)?.lines[0]?.materialName).toBe('砂')
  })

  it('删除会隐藏送货单及其明细，撤回后完整恢复', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-003',
      deliveryDate: '2026-07-15',
      note: '',
      lines: [{ materialName: '砖', spec: '240×115×53', unit: '块', qty: 1000, unitPrice: 0.5, note: '' }],
    })

    const logId = await store.remove(id)
    expect(logId).toBeTruthy()
    expect(store.byId(id)).toBeUndefined()
    expect(store.list).toHaveLength(0)

    expect(await store.undo(logId!)).toBe(true)
    expect(store.byId(id)?.lines).toHaveLength(1)
    expect(store.byId(id)?.totalAmount).toBe(500)
  })

  it('新增、编辑、删除与恢复均通过 store 写入并留操作日志', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: null,
      orderNo: 'SH-LOG-001',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 1, unitPrice: 400, note: '' }],
    })

    await store.update(id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-LOG-001A',
      deliveryDate: '2026-07-16',
      note: '已复核',
      lines: [{ materialName: '水泥', spec: 'P.O 42.5', unit: '吨', qty: 2, unitPrice: 410, note: '' }],
    })
    await store.remove(id)
    await store.restore(id)

    const logs = await mem.select<{ action: string }>(
      `SELECT action FROM operation_logs WHERE table_name = 'delivery_records' AND record_id = ?`,
      [id],
    )
    expect(logs.map(log => log.action)).toHaveLength(4)
    expect(logs.map(log => log.action)).toEqual(expect.arrayContaining(['create', 'update', 'delete', 'restore']))
    expect(store.byId(id)).toMatchObject({ orderNo: 'SH-LOG-001A', supplierId: 's1', totalAmount: 820 })
  })

  it('拒绝缺项目或没有有效材料行的录入', async () => {
    const store = useDeliveryRecordStore()
    await expect(store.add({
      projectId: '',
      supplierId: null,
      orderNo: '',
      deliveryDate: '',
      note: '',
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 1, unitPrice: 1, note: '' }],
    })).rejects.toThrow('必须选择项目')
    await expect(store.add({
      projectId: 'p1',
      supplierId: null,
      orderNo: '',
      deliveryDate: '',
      note: '',
      lines: [],
    })).rejects.toThrow('至少添加一条材料明细')
  })

  it('分供方已明确时，空单号仍受项目+分供方+单号自然键约束', async () => {
    const store = useDeliveryRecordStore()
    const input = {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: '',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    }

    await store.add(input)
    await expect(store.add(input)).rejects.toThrow()
  })

  it('归档库只暴露已归档送货单，不混入后续 OCR 处理区记录', async () => {
    await mem.execute(
      `INSERT INTO delivery_records (id, project_id, order_no, archived) VALUES ('del_pending', 'p1', 'PENDING-1', 0)`,
    )
    const store = useDeliveryRecordStore()
    await store.load()
    expect(store.list).toEqual([])
  })
})
