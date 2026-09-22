import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { createDefaultInvoiceXlsxStyleConfig, createInvoiceLedgerXlsxFromRows, readInvoiceWorkbookStyleReadback } from '~/lib/invoice/excel'
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
  it('明确清空分边颜色保存为黑色，重载后不复活旧全局颜色', async () => {
    const store = useInvoiceStore()
    await store.saveInvoiceExportStyle({
      border: { top: { color: 'FFFF0000' } },
      headerBorder: { top: { color: '' } },
    }, mem)
    setActivePinia(createPinia())
    const reloaded = useInvoiceStore()
    await reloaded.loadInvoiceExportStyle(mem)
    expect(reloaded.invoiceExportStyle.headerBorder?.top?.color).toBe('FF000000')
    expect(reloaded.invoiceExportStyle.dataBorder?.top?.color).toBe('FFFF0000')
  })

  it.each([
    [{ headerBorder: { top: { color: 'not-a-color' } } }, '边框颜色'],
    [{ dataBorder: { left: { style: 'solid' } } }, '边框线型'],
  ] as const)('无效样式 %o 拒绝保存和生成，已有默认不变', async (invalid, message) => {
    const store = useInvoiceStore()
    await store.saveInvoiceExportStyle({ freezeRows: 6 }, mem)
    const saved = await mem.select('SELECT settings_json FROM invoice_export_settings')
    await expect(store.saveInvoiceExportStyle(invalid, mem)).rejects.toThrow(message)
    expect(createInvoiceLedgerXlsxFromRows.bind(null, [], invalid)).toThrow(message)
    expect(await mem.select('SELECT settings_json FROM invoice_export_settings')).toEqual(saved)
    expect(store.invoiceExportStyle.freezeRows).toBe(6)
  })

  it('旧 border JSON 继承到两组，保存分边覆盖后实际 XLSX 与重建 store 保持一致', async () => {
    const legacy = {
      ...createDefaultInvoiceXlsxStyleConfig(),
      freezeRows: 4,
      dataRowHeight: 35,
      moneyFormat: '#,##0.000',
      border: {
        top: { style: 'medium', color: 'FF112233' },
        bottom: { style: 'dashed', color: 'FF223344' },
        left: { style: 'dotted', color: 'FF334455' },
        right: { style: 'thin', color: 'FF445566' },
      },
    }
    await mem.execute('INSERT INTO invoice_export_settings (id, settings_json) VALUES (\'default\', ?)', [JSON.stringify(legacy)])
    const store = useInvoiceStore()
    await store.loadInvoiceExportStyle(mem)
    expect(store.invoiceExportStyle.headerBorder).toEqual(legacy.border)
    expect(store.invoiceExportStyle.dataBorder).toEqual(legacy.border)
    await store.saveInvoiceExportStyle({
      ...store.invoiceExportStyle,
      headerBorder: { top: { color: '#aabbcc' } },
      dataBorder: { left: { style: 'none' } },
    }, mem)

    setActivePinia(createPinia())
    const reloaded = useInvoiceStore()
    await reloaded.loadInvoiceExportStyle(mem)
    const headerBorder = { ...legacy.border, top: { style: 'medium', color: 'FFAABBCC' } }
    const dataBorder = { ...legacy.border, left: { style: 'none', color: 'FF334455' } }
    expect(reloaded.invoiceExportStyle).toMatchObject({
      border: legacy.border,
      headerBorder,
      dataBorder,
      freezeRows: 4,
      dataRowHeight: 35,
      moneyFormat: '#,##0.000',
    })
    const bytes = createInvoiceLedgerXlsxFromRows([{
      invoiceDate: '2026-09-11',
      invoiceNumber: '0001',
      seller: '合成供应商',
      invoiceType: '普票',
      totalAmount: 123.45,
      projectName: '合成项目',
      source: 'Excel 导入',
      remark: '',
    }], reloaded.invoiceExportStyle)
    const readback = await readInvoiceWorkbookStyleReadback(bytes)
    expect(readback.issues).toEqual([])
    expect(readback.sheets[0]!.cells.A2?.border).toEqual(headerBorder)
    expect(readback.sheets[0]!.cells.A3?.border).toEqual(dataBorder)
    expect(readback.sheets[0]!.cells.A1?.border).toEqual(legacy.border)
    expect(readback.sheets[0]!.cells.E3?.numberFormat).toBe('#,##0.000')
  })

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
