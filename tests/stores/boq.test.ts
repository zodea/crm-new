import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedIfEmpty } from '~/lib/db/seed'
import { useBoqStore } from '~/stores/boq'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let db: TestDb
vi.mock('~/stores/production-access', () => ({ useProductionAccessStore: () => ({ status: { mode: 'development', authenticated: false } }) }))

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => db.execute(sql, params),
  select: async (sql: string, params?: unknown[]) => db.select(sql, params),
  withTransaction: async <T>(work: (tx: TestDb) => Promise<T>) => {
    await db.execute('BEGIN')
    try {
      const result = await work(db)
      await db.execute('COMMIT')
      return result
    }
    catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  db = await createMigratedMemoryDb()
  await seedIfEmpty(db)
  setActivePinia(createPinia())
})

afterEach(() => db.close())

describe('boq store', () => {
  it('loads one canonical workspace and refreshes it after a transactional line update', async () => {
    const store = useBoqStore()
    await store.loadCatalog()
    await store.loadWorkspace('proj_demo_001', 'con_demo_sg01')
    expect(store.workspace?.summary.lineCount).toBe(10)

    const logId = await store.updateLine('boq_line_demo_a_floor', { qty: 34 })
    expect(logId).toEqual(expect.any(String))
    expect(store.workspace?.lines.find(line => line.id === 'boq_line_demo_a_floor')).toMatchObject({
      baseQty: 34,
      recognizedQty: 31,
      manuallyCorrected: true,
    })
    expect(store.loading).toBe(false)
    expect(store.saving).toBe(false)
    expect(store.error).toBe('')
  })

  it('generates and loads a monthly statement through the store transaction boundary', async () => {
    const store = useBoqStore()
    await store.loadWorkspace('proj_demo_001', 'con_demo_sg01')
    const result = await store.generateMonthly('2026-04')
    expect(result.totalAmount).toBe(1512)
    expect(store.monthlyStatement).toMatchObject({
      id: result.statementId,
      month: '2026-04',
      totalAmount: 1512,
    })
  })

  it('persists change attachment bytes and exposes categorized download metadata', async () => {
    const store = useBoqStore()
    await store.loadWorkspace('proj_demo_001', 'con_demo_sg01')
    const saved = await store.addChangeAttachment('boq_change_demo_001', {
      fileName: '甲方指令.pdf',
      fileSize: 5,
      mimeType: 'application/pdf',
      contentBase64: 'aGVsbG8=',
      category: 'owner_directive',
    })

    expect(store.workspace?.changes[0]?.attachments).toEqual([
      expect.objectContaining({
        id: saved.id,
        fileName: '甲方指令.pdf',
        mimeType: 'application/pdf',
        category: 'owner_directive',
      }),
    ])
    const download = await store.loadAttachmentFile(saved.id)
    expect(download).toMatchObject({
      defaultName: '甲方指令.pdf',
      mimeType: 'application/pdf',
    })
    expect([...new Uint8Array(download.data as Uint8Array)]).toEqual([104, 101, 108, 108, 111])
  })
})
