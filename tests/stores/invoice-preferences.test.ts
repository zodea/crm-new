import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { createDefaultInvoiceXlsxStyleConfig } from '~/lib/invoice/excel'
import { useInvoiceStore } from '~/stores/invoice'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb

beforeEach(async () => {
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())
})

afterEach(() => {
  mem.close()
})

describe('invoice store 导出样式偏好', () => {
  it('通过 action 保存 SQLite，并在新 store 中恢复', async () => {
    const store = useInvoiceStore()
    await store.loadInvoiceExportStyle(mem)
    const next = {
      ...createDefaultInvoiceXlsxStyleConfig(),
      freezeRows: 5,
      columnWidths: {
        ...createDefaultInvoiceXlsxStyleConfig().columnWidths,
        seller: 46,
      },
    }

    await store.saveInvoiceExportStyle(next, mem)

    setActivePinia(createPinia())
    const reloaded = useInvoiceStore()
    await reloaded.loadInvoiceExportStyle(mem)

    expect(reloaded.invoiceExportStyle).toMatchObject({
      freezeRows: 5,
      columnWidths: { seller: 46 },
    })
    expect(await mem.select(`
      SELECT id FROM invoice_export_settings WHERE id = 'default'
    `)).toEqual([{ id: 'default' }])
  })
})
