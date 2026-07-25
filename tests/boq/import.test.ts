import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  autoMapBoqColumns,
  buildBoqImportRows,
  parseBoqWorkbook,
  persistBoqImport,
} from '~/lib/boq/import'
import { runMigrations } from '~/lib/db/migrations'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMemoryDb } from '../helpers/memory-db'

let db: TestDb

function workbookBuffer(): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ['合和新城户内装修清单'],
    ['分部', '工种', '分项编码', '分项名称', '单位', '工程量', '不含税单价', '户型', '房间'],
    ['机电安装', '水暖工', 'PLUMB-PIPE', '给排水管安装', 'm', 43, 36, 'A', '整户范围'],
  ])
  XLSX.utils.book_append_sheet(workbook, sheet, '户内安装')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

beforeEach(async () => {
  db = await createMemoryDb()
  await runMigrations(db)
  await seedIfEmpty(db)
})

afterEach(() => db.close())

describe('boq import pipeline', () => {
  it('detects the real header row, format class and source row trace before import', () => {
    const parsed = parseBoqWorkbook(workbookBuffer(), '新施工清单.xlsx')
    expect(parsed).toMatchObject({
      fileName: '新施工清单.xlsx',
      formatClass: 'A',
      formatLabel: '户型矩阵招标型',
    })
    expect(parsed.sheets).toHaveLength(1)
    expect(parsed.sheets[0]).toMatchObject({
      name: '户内安装',
      headerRow: 2,
      columns: ['分部', '工种', '分项编码', '分项名称', '单位', '工程量', '不含税单价', '户型', '房间'],
    })

    const mapping = autoMapBoqColumns(parsed.sheets[0]!.columns)
    const rows = buildBoqImportRows(parsed.sheets[0]!, mapping)
    expect(rows).toEqual([expect.objectContaining({
      section: '机电安装',
      trade: '水暖工',
      itemCode: 'PLUMB-PIPE',
      itemName: '给排水管安装',
      qty: 43,
      unitPrice: 36,
      unitType: 'A',
      sourceSheet: '户内安装',
      sourceRow: 3,
    })])
  })

  it('persists recognized values and makes the confirmed boq line the quantity-template source', async () => {
    const parsed = parseBoqWorkbook(workbookBuffer(), '新施工清单.xlsx')
    const sheet = parsed.sheets[0]!
    const rows = buildBoqImportRows(sheet, autoMapBoqColumns(sheet.columns))
    const result = await persistBoqImport(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      fileName: parsed.fileName,
      formatClass: parsed.formatClass,
      rows,
    })
    expect(result.lineCount).toBe(1)

    const [line] = await db.select<{
      id: string
      item_id: string
      qty: number
      recognized_qty: number
      unit_price: number
      recognized_unit_price: number
      trace_key: string
    }>('SELECT id, item_id, qty, recognized_qty, unit_price, recognized_unit_price, trace_key FROM boq_lines WHERE boq_file_id = ?', [result.fileId])
    expect(line).toMatchObject({
      item_id: 'qty_item_plumb_pipe',
      qty: 43,
      recognized_qty: 43,
      unit_price: 36,
      recognized_unit_price: 36,
      trace_key: '新施工清单.xlsx·户内安装·3',
    })
    const [templateLine] = await db.select<{
      boq_line_id: string
      recognized_contract_qty: number
      contract_qty: number
    }>('SELECT boq_line_id, recognized_contract_qty, contract_qty FROM house_type_template_items WHERE id = ?', ['qty_hti_a_pipe'])
    expect(templateLine).toEqual({
      boq_line_id: line!.id,
      recognized_contract_qty: 43,
      contract_qty: 43,
    })
  })
})
