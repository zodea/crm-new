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

async function insertInvoice(id: string) {
  await mem.execute(
    `INSERT INTO invoices (id, invoice_number, total_amount)
     VALUES (?, ?, ?)`,
    [id, `NO-${id}`, 100],
  )
}

describe('invoice store 打印计数', () => {
  it('在单个事务内累加所选发票并保存排版角度', async () => {
    await insertInvoice('print-a')
    await insertInvoice('print-b')
    const store = useInvoiceStore()
    await store.load()

    await expect(store.recordPrinted(
      ['print-a', 'print-b'],
      { 'print-a': 90, 'print-b': 180 },
    )).resolves.toBe(2)

    const rows = await mem.select<{ id: string, printCount: number, printRotation: number }>(
      `SELECT id, print_count AS printCount, print_rotation AS printRotation
       FROM invoices ORDER BY id`,
    )
    expect(rows).toEqual([
      { id: 'print-a', printCount: 1, printRotation: 90 },
      { id: 'print-b', printCount: 1, printRotation: 180 },
    ])
    expect(store.byId('print-a')).toMatchObject({ printCount: 1, printRotation: 90 })
    expect(store.byId('print-b')).toMatchObject({ printCount: 1, printRotation: 180 })
    expect(await mem.select(
      `SELECT record_id FROM operation_logs
       WHERE table_name = 'invoices' AND action = 'update'
       ORDER BY record_id`,
    )).toEqual([
      { record_id: 'print-a' },
      { record_id: 'print-b' },
    ])
  })

  it('任一所选发票已不存在时整批回滚，不产生部分计数或日志', async () => {
    await insertInvoice('print-a')
    const store = useInvoiceStore()
    await store.load()

    await expect(store.recordPrinted(
      ['print-a', 'missing'],
      { 'print-a': 90, 'missing': 180 },
    )).rejects.toThrow('PRINT_RECORD_SET_CHANGED')

    expect(await mem.select(
      `SELECT print_count AS printCount, print_rotation AS printRotation
       FROM invoices WHERE id = 'print-a'`,
    )).toEqual([{ printCount: 0, printRotation: 0 }])
    expect(await mem.select(
      `SELECT id FROM operation_logs
       WHERE table_name = 'invoices' AND action = 'update'`,
    )).toEqual([])
  })
})
