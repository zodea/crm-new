import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { useInvoiceStore } from '~/stores/invoice'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => mem.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => mem.select(sql, params),
  withTransaction: async (work: (tx: TestDb) => Promise<unknown>) => {
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
  setActivePinia(createPinia())
})

afterEach(() => {
  mem.close()
})

describe('invoice store 归档来源留痕', () => {
  it('归档使用人工确认当前值，并把原始 OCR、人工修订和来源分开写入且可重载', async () => {
    await mem.execute(`
      INSERT INTO invoices (
        id, file_name, source, ocr_status, review_status, dup_status,
        invoice_number, invoice_date, seller, total_amount
      ) VALUES (
        'archive-ocr-1', '原始票据.pdf', 'scan', 'pending', 'unreviewed', 'normal',
        '', '', '', 0
      )
    `)
    const store = useInvoiceStore()
    await store.load()

    await store.update('archive-ocr-1', {
      ...store.byId('archive-ocr-1'),
      ocrStatus: 'done',
      invoiceNumber: 'OCR-001',
      invoiceDate: '2026-08-11',
      seller: 'OCR 供应商',
      totalAmount: 110,
    })
    await store.correctField('archive-ocr-1', 'totalAmount', 113)
    await store.confirmInvoice('archive-ocr-1')

    await expect(store.archiveInvoice('archive-ocr-1', 'personal')).resolves.toEqual({ ok: true })
    expect(store.byId('archive-ocr-1')).toMatchObject({
      accountStatus: 'archived',
      ownerKind: 'personal',
      totalAmount: 113,
    })

    const audit = await store.loadInvoiceArchiveAudit('archive-ocr-1')
    expect(audit).toMatchObject({
      invoiceId: 'archive-ocr-1',
      currentValues: {
        invoiceNumber: 'OCR-001',
        seller: 'OCR 供应商',
        totalAmount: 113,
        ownerKind: 'personal',
        projectId: null,
      },
      provenance: {
        sourceKind: 'ocr',
        sourceId: '原始票据.pdf',
        sourceInfo: { fileName: '原始票据.pdf' },
        originalOcr: { totalAmount: 110 },
      },
    })
    expect(audit?.provenance.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'totalAmount',
        from: 110,
        to: 113,
        reason: '人工校对',
      }),
    ]))

    expect(await mem.select(`
      SELECT table_name, record_id, action
      FROM operation_logs
      WHERE table_name = 'invoice_archive_provenance'
    `)).toEqual([{
      table_name: 'invoice_archive_provenance',
      record_id: 'archive-ocr-1',
      action: 'create',
    }])

    setActivePinia(createPinia())
    const reloadedStore = useInvoiceStore()
    await expect(reloadedStore.loadInvoiceArchiveAudit('archive-ocr-1')).resolves.toEqual(audit)
  })

  it('归档在同一事务内重读数据库最新值并用该值写入审计', async () => {
    await mem.execute(`
      INSERT INTO invoices (
        id, file_name, source, ocr_status, review_status, dup_status,
        invoice_number, invoice_date, seller, total_amount, updated_at
      ) VALUES (
        'archive-stale-valid', '导入发票.xlsx', 'excel', 'done', 'reviewed', 'normal',
        'EXCEL-001', '2026-08-11', '内存旧供应商', 113, '2026-08-11T01:00:00.000Z'
      )
    `)
    const store = useInvoiceStore()
    await store.load()

    await mem.execute(`
      UPDATE invoices
      SET seller = '数据库最新供应商', total_amount = 200, updated_at = '2026-08-11T02:00:00.000Z'
      WHERE id = 'archive-stale-valid'
    `)

    await expect(store.archiveInvoice('archive-stale-valid', 'personal')).resolves.toEqual({ ok: true })
    expect(store.byId('archive-stale-valid')).toMatchObject({
      seller: '数据库最新供应商',
      totalAmount: 200,
      accountStatus: 'archived',
    })
    await expect(store.loadInvoiceArchiveAudit('archive-stale-valid')).resolves.toMatchObject({
      currentValues: {
        seller: '数据库最新供应商',
        totalAmount: 200,
      },
    })
  })

  it('陈旧 store 快照不能绕过事务内的最新数据库归档门禁', async () => {
    await mem.execute(`
      INSERT INTO invoices (
        id, file_name, source, ocr_status, review_status, dup_status,
        invoice_number, invoice_date, seller, total_amount, updated_at
      ) VALUES (
        'archive-stale-invalid', '导入发票.xlsx', 'excel', 'done', 'reviewed', 'normal',
        'EXCEL-002', '2026-08-11', '可归档供应商', 113, '2026-08-11T01:00:00.000Z'
      )
    `)
    const store = useInvoiceStore()
    await store.load()

    await mem.execute(`
      UPDATE invoices
      SET total_amount = 0, updated_at = '2026-08-11T02:00:00.000Z'
      WHERE id = 'archive-stale-invalid'
    `)

    const result = await store.archiveInvoice('archive-stale-invalid', 'personal')
    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining('金额异常'),
    })
    expect(await mem.select(`
      SELECT account_status
      FROM invoices
      WHERE id = 'archive-stale-invalid'
    `)).toEqual([{ account_status: 'none' }])
    await expect(store.loadInvoiceArchiveAudit('archive-stale-invalid')).resolves.toBeNull()
  })
})
