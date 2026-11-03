import { describe, expect, it, onTestFinished } from 'vitest'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { columnNames, createMemoryDb, createMigratedMemoryDb, listTables } from '../helpers/memory-db'

describe('送货单 pass-1：版本化持久化', () => {
  it('冷启动后具备送货单头、明细表与必需字段', async () => {
    const db = await createMigratedMemoryDb()
    onTestFinished(() => db.close())

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
  })

  it('升级存量归档记录时视为已入库，但不伪造打印成功回执', async () => {
    const db = await createMemoryDb()
    onTestFinished(() => db.close())
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
  })

  it('新建底层记录默认留在待识别处理区，不自动冒充已归档', async () => {
    const db = await createMigratedMemoryDb()
    onTestFinished(() => db.close())
    await db.execute(`INSERT INTO projects (id, name) VALUES ('p-default', '默认值项目')`)
    await db.execute(`INSERT INTO delivery_records (id, project_id) VALUES ('del-default', 'p-default')`)

    const [record] = await db.select<{ ocr_status: string, archived: number, stored: number }>(
      `SELECT ocr_status, archived, stored FROM delivery_records WHERE id = 'del-default'`,
    )
    expect(record).toEqual({ ocr_status: 'pending', archived: 0, stored: 0 })
  })
})
