import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadProjectDeliveryArchive } from '~/lib/project/delivery-archive'
import { createMemoryDb } from '../helpers/memory-db'

describe('project delivery archive read model', () => {
  it('only aggregates archived delivery records and their visible source lines', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-delivery', '到货客户')`)
    await db.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES
        ('project-delivery', '到货项目', 'customer-delivery'),
        ('project-delivery-other', '其他到货项目', 'customer-delivery')
    `)
    await db.execute(`INSERT INTO suppliers (id, name) VALUES ('supplier-delivery', '到货分供方')`)
    await db.execute(`
      INSERT INTO delivery_records (
        id, project_id, supplier_id, order_no, delivery_date, file_name,
        ocr_status, archived, stored, review_flag, deleted_at
      )
      VALUES
        (
          'delivery-archived', 'project-delivery', 'supplier-delivery',
          'SH-ARCHIVED', '2026-07-03', 'legacy-name.pdf',
          'reviewed', 1, 0, '', NULL
        ),
        (
          'delivery-missing-supplier', 'project-delivery', NULL,
          'SH-MISSING', '2026-07-02', '',
          'reviewed', 1, 0, '待补分供方', NULL
        ),
        (
          'delivery-processing', 'project-delivery', 'supplier-delivery',
          'SH-PROCESSING', '2026-07-04', 'processing.pdf',
          'recognizing', 0, 0, '待核对', NULL
        ),
        (
          'delivery-deleted', 'project-delivery', 'supplier-delivery',
          'SH-DELETED', '2026-07-05', 'deleted.pdf',
          'reviewed', 1, 0, '', '2026-07-06'
        ),
        (
          'delivery-other', 'project-delivery-other', 'supplier-delivery',
          'SH-OTHER', '2026-07-01', 'other.pdf',
          'reviewed', 1, 1, '', NULL
        )
    `)
    await db.execute(`
      INSERT INTO delivery_lines (
        id, delivery_record_id, material_name, qty, amount, sort_order, deleted_at
      )
      VALUES
        ('line-visible-1', 'delivery-archived', '材料甲', 2, 20, 10, NULL),
        ('line-visible-2', 'delivery-archived', '材料乙', 3, 30, 20, NULL),
        ('line-deleted', 'delivery-archived', '已删材料', 99, 990, 30, '2026-07-06'),
        ('line-processing', 'delivery-processing', '处理中材料', 50, 500, 10, NULL),
        ('line-other', 'delivery-other', '其他项目材料', 8, 80, 10, NULL)
    `)
    await db.execute(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, category
      )
      VALUES (
        'delivery-source-file', 'delivery_record', 'delivery-archived',
        'canonical-source.pdf', 'source'
      )
    `)

    const rows = await loadProjectDeliveryArchive(db)
    expect(rows.filter(row => row.projectId === 'project-delivery')).toEqual([
      expect.objectContaining({
        id: 'delivery-archived',
        supplier: '到货分供方',
        lineCount: 2,
        totalQty: 5,
        totalAmount: 50,
        fileName: 'canonical-source.pdf',
        sourceFileId: 'delivery-source-file',
        hasSourceFile: true,
        sourceStatus: '原件已关联',
        printStatus: '已排除',
        sourcePath: '/material/delivery/archive/delivery-archived',
      }),
      expect.objectContaining({
        id: 'delivery-missing-supplier',
        supplier: '',
        lineCount: 0,
        totalQty: 0,
        totalAmount: 0,
        reviewFlag: '待补分供方',
        sourceStatus: '无原件',
      }),
    ])
    expect(rows.some(row => row.id === 'delivery-processing')).toBe(false)
    expect(rows.some(row => row.id === 'delivery-deleted')).toBe(false)
    expect(rows.some(row => row.id === 'delivery-other')).toBe(true)
  })
})
