import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  autoMapBoqColumns,
  buildBoqImportRows,
  parseBoqWorkbook,
  persistBoqImport,
} from '~/lib/boq/import'
import { seedIfEmpty } from '~/lib/db/seed'
import { createMigratedMemoryDb } from '../helpers/memory-db'

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

function multiSheetBuffer(): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['施工合同封面'],
    ['项目', '合和新城'],
  ]), '封面')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['分部', '分项名称', '单位', '合同单价', 'A户型', '', 'B户型', ''],
    ['', '', '', '', '工程量', '套数', '工程量', '套数'],
    ['装修', '墙砖铺贴', '㎡', 100, 20, 3, 22, 2],
  ]), '户型矩阵')
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

beforeEach(async () => {
  db = await createMigratedMemoryDb()
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

  it('skips cover sheets and expands multi-row household matrix headers', () => {
    const parsed = parseBoqWorkbook(multiSheetBuffer(), '户型招标清单.xlsx')

    expect(parsed.formatClass).toBe('A')
    expect(parsed.ignoredSheets).toEqual(['封面'])
    expect(parsed.sheets).toHaveLength(1)
    const sheet = parsed.sheets[0]!
    const rows = buildBoqImportRows(sheet, autoMapBoqColumns(sheet.columns), parsed.formatClass)
    expect(rows).toEqual([
      expect.objectContaining({ itemName: '墙砖铺贴', unitType: 'A', qty: 20, multiplier: 3 }),
      expect.objectContaining({ itemName: '墙砖铺贴', unitType: 'B', qty: 22, multiplier: 2 }),
    ])
  })

  it.each([
    { format: 'B' as const, expected: { room: '厨房' } },
    { format: 'E' as const, expected: { qty: 1 } },
  ])('applies $format quantity and location rules', ({ format, expected }) => {
    const sheet = {
      name: '交标',
      headerRow: 1,
      columns: ['分项名称', '单位', '工程量', '合同单价'],
      rows: [{
        sourceRow: 2,
        values: { 分项名称: '墙砖铺贴于厨房', 单位: '㎡', 工程量: 5, 合同单价: 100 },
      }],
    }
    const mapping = autoMapBoqColumns(sheet.columns)
    const selectedMapping = format === 'B'
      ? mapping
      : {
          itemName: mapping.itemName,
          unit: mapping.unit,
          unitPrice: mapping.unitPrice,
        }
    expect(buildBoqImportRows(sheet, selectedMapping, format)[0]).toMatchObject(expected)
  })

  it('persists E-class rows to the item unit-price library without creating contract quantities', async () => {
    const rows = buildBoqImportRows({
      name: '基准价清单',
      headerRow: 1,
      columns: ['分项编码', '分项名称', '单位', '合同单价', '特征描述'],
      rows: [{
        sourceRow: 2,
        values: {
          分项编码: 'DEC-WALL-TILE',
          分项名称: '墙砖铺贴',
          单位: '㎡',
          合同单价: 120,
          特征描述: '零星维修',
        },
      }],
    }, {
      itemCode: '分项编码',
      itemName: '分项名称',
      unit: '单位',
      unitPrice: '合同单价',
      spec: '特征描述',
    }, 'E')
    const result = await persistBoqImport(db, {
      projectId: 'proj_demo_001',
      contractId: 'con_demo_sg01',
      fileName: '零星维修.xlsx',
      formatClass: 'E',
      rows,
    })

    expect(result).toMatchObject({ lineCount: 0, unitPriceCount: 1, linkedTemplateLineCount: 0 })
    expect(await db.select(`SELECT id FROM boq_lines WHERE boq_file_id = ?`, [result.fileId])).toEqual([])
    expect(await db.select(`
      SELECT item_name, unit, unit_price, spec, trace_key
      FROM item_unit_prices
      WHERE boq_file_id = ?
    `, [result.fileId])).toEqual([{
      item_name: '墙砖铺贴',
      unit: '㎡',
      unit_price: 120,
      spec: '零星维修',
      trace_key: '零星维修.xlsx·基准价清单·2',
    }])
  })

  it('applies C row-state context and D floor/section context', () => {
    const columns = ['行类型', '分项名称', '单位', '工程量', '合同单价']
    const mapping = autoMapBoqColumns(columns)
    const structured = buildBoqImportRows({
      name: '清单',
      headerRow: 1,
      columns,
      rows: [
        { sourceRow: 2, values: { 行类型: 'A1章', 分项名称: '装饰工程' } },
        { sourceRow: 3, values: { 行类型: 'BQDESC', 分项名称: '瓷砖胶薄贴' } },
        { sourceRow: 4, values: { 行类型: 'BQITEM', 分项名称: '墙砖铺贴', 单位: '㎡', 工程量: 20, 合同单价: 100 } },
        { sourceRow: 5, values: { 行类型: 'TOTAL', 分项名称: '合计' } },
      ],
    }, mapping, 'C')
    expect(structured).toEqual([
      expect.objectContaining({ section: '装饰工程', itemName: '墙砖铺贴', spec: '瓷砖胶薄贴' }),
    ])

    const floorRows = buildBoqImportRows({
      name: '商业',
      headerRow: 1,
      columns,
      rows: [
        { sourceRow: 2, values: { 分项名称: '首层' } },
        { sourceRow: 3, values: { 分项名称: '装饰工程' } },
        { sourceRow: 4, values: { 分项名称: '地砖铺贴', 单位: '㎡', 工程量: 31, 合同单价: 80 } },
      ],
    }, mapping, 'D')
    expect(floorRows).toEqual([
      expect.objectContaining({ section: '装饰工程', floorZone: '首层', itemName: '地砖铺贴' }),
    ])
  })

  it('persists recognized values and makes the confirmed boq line the quantity-template source', async () => {
    await db.execute(`
      INSERT INTO house_type_template_items
        (id, room_id, item_id, contract_qty, sort_order)
      VALUES ('qty_hti_a_pipe_bath', 'qty_room_a_bath', 'qty_item_plumb_pipe', 9, 99)
    `)
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
    expect(await db.select(`
      SELECT boq_line_id, recognized_contract_qty, contract_qty
      FROM house_type_template_items
      WHERE id = 'qty_hti_a_pipe_bath'
    `)).toEqual([{
      boq_line_id: null,
      recognized_contract_qty: null,
      contract_qty: 9,
    }])
  })
})
