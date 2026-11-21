import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { editDeliveryAmountLine } from '~/lib/delivery/review'
import { useDeliveryRecordStore } from '~/stores/delivery-record'
import { columnNames, createMemoryDb, createMigratedMemoryDb, listTables } from '../helpers/memory-db'

let mem: TestDb
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
let failTransactionSql: RegExp | null = null
let transactionQueue: Promise<void> = Promise.resolve()

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: <T>(work: (tx: TestDb) => Promise<T>) => {
    const operation = async () => {
      await mem.execute('BEGIN')
      try {
        const result = await work({
          ...mem,
          async execute(sql, params) {
            if (failTransactionSql?.test(sql))
              throw new Error('injected transaction failure')
            return mem.execute(sql, params)
          },
          async select<T>(sql: string, params?: unknown[]) {
            return mem.select<T>(sql, params)
          },
        })
        await mem.execute('COMMIT')
        return result
      }
      catch (error) {
        await mem.execute('ROLLBACK')
        throw error
      }
    }
    const result = transactionQueue.then(operation, operation)
    transactionQueue = result.then(() => undefined, () => undefined)
    return result
  },
}))

beforeEach(async ({ onTestFinished }) => {
  failTransactionSql = null
  transactionQueue = Promise.resolve()
  mem = await createMigratedMemoryDb()
  onTestFinished(mem.close)
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
      'print_batch_id',
      'print_disposition',
      'printed_at',
      'print_excluded_at',
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
      'amount_source',
      'sort_order',
      'deleted_at',
    ]))

    db.close()
  })

  it('升级存量归档记录时视为已入库，但不伪造打印成功回执', async () => {
    const db = await createMemoryDb()
    await runMigrations(db, migrations.filter(migration => migration.version <= 24))
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p-legacy-print', '存量打印项目')`)
    await db.execute(`
      INSERT INTO delivery_records (
        id, project_id, order_no, archived, stored, ocr_status
      )
      VALUES (
        'del-legacy-print', 'p-legacy-print', 'LEGACY-PRINT-1', 1, 0, 'reviewed'
      )
    `)

    const result = await runMigrations(db)
    const [record] = await db.select<{
      stored: number
      print_batch_id: string
      print_disposition: string
      printed_at: string | null
      print_excluded_at: string | null
    }>(`
      SELECT stored, print_batch_id, print_disposition, printed_at, print_excluded_at
      FROM delivery_records
      WHERE id = 'del-legacy-print'
    `)

    expect(result.applied).toContain('v25 delivery-archive-print-disposition')
    expect(result.applied).toContain('v32 delivery-print-batches')
    expect(record).toEqual({
      stored: 1,
      print_batch_id: 'del-legacy-print',
      print_disposition: 'excluded',
      printed_at: null,
      print_excluded_at: null,
    })
    db.close()
  })

  it('新建底层记录默认留在待识别处理区，不自动冒充已归档', async () => {
    const db = await createMigratedMemoryDb()
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
      stored: true,
      printBatchId: id,
      printDisposition: 'pending',
      printedAt: '',
      printExcludedAt: '',
      totalAmount: 10760,
    })
    expect(store.byId(id)?.lines.map(line => ({ name: line.materialName, amount: line.amount }))).toEqual([
      { name: 'HRB400 螺纹钢', amount: 9500 },
      { name: '水泥', amount: 1260 },
    ])
  })

  it('归档默认待打印；排除打印不写已打印，只有打印回执才写已打印', async () => {
    const store = useDeliveryRecordStore()
    const firstId = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-PRINT-001',
      deliveryDate: '2026-07-18',
      note: '',
      lines: [{ materialName: '待打印材料', spec: '', unit: '件', qty: 1, unitPrice: 10, note: '' }],
    })

    let [first] = await mem.select<{
      print_disposition: string
      printed_at: string | null
      print_excluded_at: string | null
    }>(`
      SELECT print_disposition, printed_at, print_excluded_at
      FROM delivery_records
      WHERE id = ?
    `, [firstId])
    expect(first).toEqual({
      print_disposition: 'pending',
      printed_at: null,
      print_excluded_at: null,
    })

    await store.excludeFromPrint(firstId)
    ;[first] = await mem.select<{
      print_disposition: string
      printed_at: string | null
      print_excluded_at: string | null
    }>(`
      SELECT print_disposition, printed_at, print_excluded_at
      FROM delivery_records
      WHERE id = ?
    `, [firstId])
    expect(first).toMatchObject({
      print_disposition: 'excluded',
      printed_at: null,
    })
    expect(first?.print_excluded_at).toBeTruthy()
    await expect(
      store.confirmPrintReceipt(firstId),
    ).rejects.toThrow('打印状态已变化')

    const secondId = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-PRINT-002',
      deliveryDate: '2026-07-18',
      note: '',
      lines: [{ materialName: '打印回执材料', spec: '', unit: '件', qty: 2, unitPrice: 10, note: '' }],
    })
    await store.confirmPrintReceipt(secondId)
    const [second] = await mem.select<{
      print_disposition: string
      printed_at: string | null
      print_excluded_at: string | null
    }>(`
      SELECT print_disposition, printed_at, print_excluded_at
      FROM delivery_records
      WHERE id = ?
    `, [secondId])
    expect(second).toMatchObject({
      print_disposition: 'printed',
      print_excluded_at: null,
    })
    expect(second?.printed_at).toBeTruthy()
    await expect(
      store.excludeFromPrint(secondId),
    ).rejects.toThrow('打印状态已变化')
  })

  it('批量打印回执遇到任一非待打印记录时整批回滚', async () => {
    const store = useDeliveryRecordStore()
    const firstId = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-PRINT-BATCH-001',
      deliveryDate: '2026-07-18',
      printBatchId: 'batch-shared',
      note: '',
      lines: [{ materialName: '第一张材料', spec: '', unit: '件', qty: 1, unitPrice: 10, note: '' }],
    })
    const secondId = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-PRINT-BATCH-002',
      deliveryDate: '2026-07-18',
      printBatchId: 'batch-shared',
      note: '',
      lines: [{ materialName: '第二张材料', spec: '', unit: '件', qty: 1, unitPrice: 20, note: '' }],
    })

    await store.excludeFromPrint(firstId)
    await expect(
      store.confirmManyPrintReceipts([firstId, secondId]),
    ).rejects.toThrow('打印状态已变化')

    expect(await mem.select<{
      id: string
      print_disposition: string
      printed_at: string | null
    }>(`
      SELECT id, print_disposition, printed_at
      FROM delivery_records
      WHERE id IN (?, ?)
      ORDER BY id
    `, [firstId, secondId])).toEqual([
      { id: firstId, print_disposition: 'excluded', printed_at: null },
      { id: secondId, print_disposition: 'pending', printed_at: null },
    ].sort((a, b) => a.id.localeCompare(b.id)))
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

    expect(store.byId(id)?.lines[0]).toMatchObject({ amount: 175, amountSource: 'manual' })
    expect(store.byId(id)?.totalAmount).toBe(175)
  })

  it('自动金额来源跨保存与重载保留，后续仍可随数量单价联动', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-CALCULATED-SOURCE',
      deliveryDate: '2026-07-17',
      note: '',
      lines: [{ materialName: '自动计价材料', spec: '', unit: '件', qty: 2, unitPrice: 10, note: '' }],
    })

    expect(store.byId(id)?.lines[0]).toMatchObject({ amount: 20, amountSource: 'calculated' })
    const [row] = await mem.select<{ amount: number | null, amount_source: string }>(
      'SELECT amount, amount_source FROM delivery_lines WHERE delivery_record_id = ?',
      [id],
    )
    expect(row).toEqual({ amount: 20, amount_source: 'calculated' })

    await store.load()
    const reloaded = store.byId(id)?.lines[0]
    expect(reloaded).toMatchObject({ amount: 20, amountSource: 'calculated' })
    expect(editDeliveryAmountLine(reloaded!, 'qty', 3)).toMatchObject({ qty: 3, amount: 30 })
  })

  it('费用行的缺失数量与单价以 NULL 持久化，不伪装成零值', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'FEE-NULL-001',
      deliveryDate: '2026-07-17',
      note: '费用凭证',
      confirmations: { pricePendingConfirmed: true },
      lines: [{
        materialName: '卸货服务费',
        spec: '',
        unit: '',
        qty: null,
        unitPrice: null,
        amount: 615,
        note: '',
      }],
    })

    expect(store.byId(id)?.lines[0]).toMatchObject({
      qty: null,
      unitPrice: null,
      amount: 615,
    })
    const [row] = await mem.select<{ qty: number | null, unit_price: number | null, amount: number | null }>(
      'SELECT qty, unit_price, amount FROM delivery_lines WHERE delivery_record_id = ?',
      [id],
    )
    expect(row).toEqual({ qty: null, unit_price: null, amount: 615 })
  })

  it('明确清空的金额即使数量和单价存在也保持为 NULL', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: null,
      orderNo: 'SH-NULL-AMOUNT-001',
      deliveryDate: '2026-07-17',
      note: '',
      confirmations: { pricePendingConfirmed: true },
      lines: [{
        materialName: '待复核材料',
        spec: '',
        unit: '件',
        qty: 2,
        unitPrice: 10,
        amount: null,
        note: '',
      }],
    })

    expect(store.byId(id)?.lines[0]).toMatchObject({ amount: null, amountSource: 'manual' })
    const [row] = await mem.select<{ amount: number | null }>(
      'SELECT amount FROM delivery_lines WHERE delivery_record_id = ?',
      [id],
    )
    expect(row?.amount).toBeNull()

    await store.load()
    expect(store.byId(id)?.lines[0]?.amount).toBeNull()
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

  it('归档原件按需读取，普通编辑不会清空原件或 OCR 元数据', async () => {
    const store = useDeliveryRecordStore()
    const sourceBytes = new Uint8Array([0x00, 0x80, 0xFF, 0x12])
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-SOURCE-001',
      deliveryDate: '2026-07-17',
      rawSiteText: '合和新城项目部',
      fileName: '原送货单.pdf',
      filePath: 'legacy-cache-path',
      note: '',
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 1, unitPrice: 400, note: '' }],
    }, new File([sourceBytes], '原送货单.pdf', { type: 'application/pdf' }))

    expect(store.byId(id)?.hasSourceFile).toBe(true)
    expect((await store.loadSourceFile(id))?.bytes).toEqual(sourceBytes)

    await store.update(id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'SH-SOURCE-001-A',
      deliveryDate: '2026-07-18',
      note: '复核后编辑',
      lines: [{ materialName: '水泥', spec: 'P.O 42.5', unit: '吨', qty: 2, unitPrice: 410, note: '' }],
    })

    const [record] = await mem.select<{ raw_site_text: string, file_name: string, file_path: string }>(
      'SELECT raw_site_text, file_name, file_path FROM delivery_records WHERE id = ?',
      [id],
    )
    expect(record).toEqual({
      raw_site_text: '合和新城项目部',
      file_name: '原送货单.pdf',
      file_path: 'legacy-cache-path',
    })
    expect((await store.loadSourceFile(id))?.bytes).toEqual(sourceBytes)

    const attachmentLogs = await mem.select<{ table_name: string }>(
      `SELECT table_name FROM operation_logs
       WHERE table_name IN ('file_refs', 'file_payloads')`,
    )
    expect(attachmentLogs).toEqual([])
  })

  it('旧归档没有原件时返回 null，并在列表轻量标记为缺原件', async () => {
    await mem.execute(
      `INSERT INTO delivery_records
        (id, project_id, order_no, archived, ocr_status)
       VALUES ('del-legacy-no-source', 'p1', 'LEGACY-NO-SOURCE', 1, 'reviewed')`,
    )
    // 模拟曾写入轻量附件元数据、但正文已缺失的存量异常；不能误报为可预览原件。
    await mem.execute(
      `INSERT INTO file_refs
        (id, owner_type, owner_id, file_name, category, mime_type)
       VALUES (
         'file-legacy-metadata-only',
         'delivery_record',
         'del-legacy-no-source',
         '已丢失原件.pdf',
         'source',
         'application/pdf'
       )`,
    )
    const store = useDeliveryRecordStore()
    await store.load()

    expect(store.byId('del-legacy-no-source')?.hasSourceFile).toBe(false)
    await expect(store.loadSourceFile('del-legacy-no-source')).resolves.toBeNull()
  })

  it('旧归档可补传并原位替换原件，始终只保留一个 source 附件', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: null,
      orderNo: 'SH-SOURCE-REPLACE',
      deliveryDate: '2026-07-17',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    })

    await store.saveSourceFile(id, new File([
      new Uint8Array([0x00, 0x80, 0xFF]),
    ], '补传.png', { type: 'image/png' }))
    expect(store.byId(id)?.hasSourceFile).toBe(true)

    const replacementBytes = new Uint8Array([0xFF, 0x00, 0x80, 0x34])
    await store.saveSourceFile(
      id,
      new File([replacementBytes], '替换.jpg', { type: 'image/jpeg' }),
    )

    const refs = await mem.select<{ file_name: string, mime_type: string }>(
      `SELECT file_name, mime_type FROM file_refs
       WHERE owner_type = 'delivery_record' AND owner_id = ?
         AND category = 'source' AND deleted_at IS NULL`,
      [id],
    )
    expect(refs).toEqual([{ file_name: '替换.jpg', mime_type: 'image/jpeg' }])
    const source = await store.loadSourceFile(id)
    expect(source).toMatchObject({
      fileName: '替换.jpg',
      mimeType: 'image/jpeg',
      fileSize: replacementBytes.byteLength,
    })
    expect(source?.bytes).toEqual(replacementBytes)
    expect(store.byId(id)?.fileName).toBe('替换.jpg')
  })

  it('补传原件中途失败时，附件元数据、正文和单头文件名整体回滚', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: null,
      orderNo: 'SH-SOURCE-ROLLBACK',
      deliveryDate: '2026-07-17',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    })

    failTransactionSql = /UPDATE delivery_records/
    await expect(store.saveSourceFile(
      id,
      new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], '补传.png', { type: 'image/png' }),
    )).rejects.toThrow('injected transaction failure')

    const [attachmentCounts] = await mem.select<{ refs: number, payloads: number }>(
      `SELECT
         (SELECT COUNT(*) FROM file_refs
          WHERE owner_type = 'delivery_record' AND owner_id = ? AND category = 'source') AS refs,
         (SELECT COUNT(*) FROM file_payloads) AS payloads`,
      [id],
    )
    const [record] = await mem.select<{ file_name: string }>(
      'SELECT file_name FROM delivery_records WHERE id = ?',
      [id],
    )
    expect(attachmentCounts).toEqual({ refs: 0, payloads: 0 })
    expect(record?.file_name).toBe('')
    expect(store.byId(id)).toMatchObject({ fileName: '', hasSourceFile: false })
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

  it('直接新增会拒绝与存量非规范单号等价的自然键', async () => {
    await mem.execute(`
      INSERT INTO delivery_records
        (id, project_id, supplier_id, order_no, delivery_date, ocr_status, archived, stored)
      VALUES ('legacy-order-abc', 'p1', 's1', 'abc', '2026-07-15', 'reviewed', 1, 1)
    `)
    const store = useDeliveryRecordStore()

    await expect(store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: ' ＡｂＣ ',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    })).rejects.toThrow('送货单自然键重复')

    const [{ count: recordCount }] = await mem.select<{ count: number }>(
      'SELECT count(*) AS count FROM delivery_records WHERE deleted_at IS NULL',
    )
    const [{ count: lineCount }] = await mem.select<{ count: number }>(
      'SELECT count(*) AS count FROM delivery_lines WHERE deleted_at IS NULL',
    )
    expect({ recordCount, lineCount }).toEqual({ recordCount: 1, lineCount: 0 })
  })

  it('直接新增在持久边界把非空单号写成规范值', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: '  ｄｅｆ－００１  ',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    })

    const [row] = await mem.select<{ order_no: string | null }>(
      'SELECT order_no FROM delivery_records WHERE id = ?',
      [id],
    )
    expect(row?.order_no).toBe('DEF-001')
    expect(store.byId(id)?.orderNo).toBe('DEF-001')
  })

  it('直接编辑会拒绝与另一张送货单等价的单号并整体回滚', async () => {
    const store = useDeliveryRecordStore()
    await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'ABC',
      deliveryDate: '2026-07-15',
      note: '',
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 1, unitPrice: 400, note: '' }],
    })
    const editedId = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'DEF',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    })

    await expect(store.update(editedId, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'ａｂｃ',
      deliveryDate: '2026-07-17',
      note: '不应保存',
      lines: [{ materialName: '错误材料', spec: '', unit: '件', qty: 1, unitPrice: 1, note: '' }],
    })).rejects.toThrow('送货单自然键重复')

    await store.load()
    expect(store.byId(editedId)).toMatchObject({
      orderNo: 'DEF',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '砂' }],
    })
    const [{ count: updateLogCount }] = await mem.select<{ count: number }>(
      `SELECT count(*) AS count
       FROM operation_logs
       WHERE table_name = 'delivery_records' AND record_id = ? AND action = 'update'`,
      [editedId],
    )
    expect(updateLogCount).toBe(0)
  })

  it('直接编辑排除自身自然键并把等价单号保持为规范值', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'ABC',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    })

    await expect(store.update(id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: '  ａｂｃ  ',
      deliveryDate: '2026-07-17',
      note: '仅更新同一张单据',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 2, unitPrice: 80, note: '' }],
    })).resolves.toEqual(expect.any(String))

    const [row] = await mem.select<{ order_no: string | null }>(
      'SELECT order_no FROM delivery_records WHERE id = ?',
      [id],
    )
    expect(row?.order_no).toBe('ABC')
    expect(store.byId(id)).toMatchObject({ orderNo: 'ABC', totalAmount: 160 })
  })

  it('并发新增等价单号时仅一张成功且数据库自然键保持唯一', async () => {
    const store = useDeliveryRecordStore()
    const input = {
      projectId: 'p1',
      supplierId: 's1',
      deliveryDate: '2026-07-16',
      note: '',
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    }

    const results = await Promise.allSettled([
      store.add({ ...input, orderNo: 'race-abc' }),
      store.add({ ...input, orderNo: 'ＲＡＣＥ－ＡＢＣ' }),
    ])
    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]?.reason)).toContain('送货单自然键重复')
    const rows = await mem.select<{ order_no: string | null }>(
      `SELECT order_no
       FROM delivery_records
       WHERE project_id = 'p1' AND supplier_id = 's1' AND deleted_at IS NULL`,
    )
    expect(rows).toEqual([{ order_no: 'RACE-ABC' }])
  })

  it('空单号不形成自然键，同项目和分供方可连续归档多张无单号单据', async () => {
    const store = useDeliveryRecordStore()
    const input = {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: '',
      deliveryDate: '2026-07-16',
      note: '',
      confirmations: { noOrderNoConfirmed: true },
      lines: [{ materialName: '砂', spec: '', unit: '方', qty: 1, unitPrice: 80, note: '' }],
    }

    const firstId = await store.add(input)
    const secondId = await store.add(input)

    expect(secondId).not.toBe(firstId)
    expect(store.list.filter(record => record.orderNo === '')).toHaveLength(2)
    expect(store.list.every(record => !record.naturalKeyDuplicate)).toBe(true)
  })

  it('直接新增必须取得当前无单号与价格待补录确认，取消时不写入任何记录', async () => {
    const store = useDeliveryRecordStore()
    const pendingInput = {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: '\u3000',
      deliveryDate: '2026-07-18',
      note: '',
      lines: [{
        materialName: '待补价水泥',
        spec: '',
        unit: '吨',
        qty: 1,
        unitPrice: null,
        amount: null,
        note: '',
      }],
    }

    await expect(store.add(pendingInput)).rejects.toThrow('确认原件确实无单号')
    await expect(store.add({
      ...pendingInput,
      confirmations: { noOrderNoConfirmed: true },
    })).rejects.toThrow('确认按“价格待补录”归档')

    const [{ count: recordCount }] = await mem.select<{ count: number }>(
      'SELECT count(*) AS count FROM delivery_records WHERE deleted_at IS NULL',
    )
    const [{ count: lineCount }] = await mem.select<{ count: number }>(
      'SELECT count(*) AS count FROM delivery_lines WHERE deleted_at IS NULL',
    )
    expect({ recordCount, lineCount }).toEqual({ recordCount: 0, lineCount: 0 })
  })

  it('新增和编辑按当前事实重建受管复核标记并保留其他人工复核标记', async () => {
    const store = useDeliveryRecordStore()
    const id = await store.add({
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'MANAGED-FLAG-001',
      deliveryDate: '2026-07-18',
      note: '',
      reviewFlag: '金额已人工复核；原件无单号；价格待补录',
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 1, unitPrice: 400, amount: 400, note: '' }],
    })

    expect(store.byId(id)?.reviewFlag).toBe('金额已人工复核')

    await expect(store.update(id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: '\u3000',
      deliveryDate: '2026-07-18',
      note: '',
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 1, unitPrice: null, amount: null, note: '' }],
    })).rejects.toThrow('确认原件确实无单号')
    expect(store.byId(id)).toMatchObject({
      orderNo: 'MANAGED-FLAG-001',
      reviewFlag: '金额已人工复核',
      lines: [{ unitPrice: 400, amount: 400 }],
    })

    await store.update(id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: '\u3000',
      deliveryDate: '2026-07-18',
      note: '',
      confirmations: {
        noOrderNoConfirmed: true,
        pricePendingConfirmed: true,
      },
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 1, unitPrice: null, amount: null, note: '' }],
    })
    expect(store.byId(id)).toMatchObject({
      orderNo: '',
      reviewFlag: '金额已人工复核；原件无单号；价格待补录',
      lines: [{ unitPrice: null, amount: null }],
    })

    await store.update(id, {
      projectId: 'p1',
      supplierId: 's1',
      orderNo: 'managed-flag-002',
      deliveryDate: '2026-07-19',
      note: '',
      lines: [{ materialName: '水泥', spec: '', unit: '吨', qty: 2, unitPrice: 410, amount: 820, note: '' }],
    })
    expect(store.byId(id)).toMatchObject({
      orderNo: 'MANAGED-FLAG-002',
      reviewFlag: '金额已人工复核',
      lines: [{ unitPrice: 410, amount: 820 }],
    })
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
