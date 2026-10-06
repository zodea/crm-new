import type { MaterialContractLineImportRow } from '~/lib/material-contract/import'
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { autoMatchColumns } from '~/lib/kit/import-mapping'
import { appendMaterialContractLineImport, MATERIAL_CONTRACT_LINE_IMPORT_FIELDS, materialContractLineImportErrors, prepareMaterialContractLineImport } from '~/lib/material-contract/import'

function prepared(): MaterialContractLineImportRow[] {
  const sheet = { name: '材料', headerRow: 0, range: 'A1:F4', mergeRanges: [], formulaCount: 0, sourceFileName: '真实列.xlsx', sourceHash: 'a'.repeat(64), columns: ['材料名称', '规格', '材质', '单位', '数量', '含税单价'], rowNumbers: [2, 4], rows: [{ 材料名称: '方管', 规格: '40×40', 材质: '304', 单位: '米', 数量: '100', 含税单价: '20' }, { 材料名称: '方管', 规格: '40×40', 数量: '80', 含税单价: '30' }] }
  return prepareMaterialContractLineImport(sheet, autoMatchColumns(sheet.columns, MATERIAL_CONTRACT_LINE_IMPORT_FIELDS))
}
describe('材采文件整批追加', () => {
  it('接受页面响应式已有行且不共享原来源对象；追加保留原稳定 ID', () => {
    const rows = prepared().slice(0, 1)
    rows[0]!.values.priceUnit = '米'
    rows[0]!.verified = true
    const existing = reactive([{ id: 'existing-line', materialName: '原材料', source: { ...rows[0]!.source, externalRef: null, priceUnit: '米', quantityUnitVerified: true } }])
    const appended = appendMaterialContractLineImport(existing, rows)
    appended[0]!.source!.priceUnit = '根'
    expect(existing[0]!.source.priceUnit).toBe('米')
    expect(appended[0]!.id).toBe('existing-line')
    expect(appended[1]!.source!.rowNumber).toBe(2)
  })
  it('原行定位与缺材质保留，缺单位和计价单位不得默认；错误全部修好再追加', () => {
    const rows = prepared()
    expect(rows.map(row => row.source.rowNumber)).toEqual([2, 4])
    expect(rows[1]?.values.materialGrade).toBe('')
    expect(rows[1]?.values.unit).toBe('')
    const existing = [{ id: 'original-line', materialName: '原方管', qty: 1, taxInclusiveUnitPrice: 1 }]
    rows[0]!.values.priceUnit = '米'
    rows[0]!.verified = true
    expect(() => appendMaterialContractLineImport(existing, rows)).toThrow('第 4 行')
    expect(existing).toEqual([{ id: 'original-line', materialName: '原方管', qty: 1, taxInclusiveUnitPrice: 1 }])
    rows[1]!.values.unit = '米'
    rows[1]!.values.priceUnit = '米'
    rows[1]!.verified = true
    const appended = appendMaterialContractLineImport(existing, rows)
    expect(appended).toHaveLength(3)
    expect(appended[0]).toEqual(existing[0])
    expect(appended[1]).toMatchObject({ materialName: '方管', materialGrade: '304', qty: 100, taxInclusiveUnitPrice: 20, source: { fileName: '真实列.xlsx', sheetName: '材料', rowNumber: 2, sourceHash: 'a'.repeat(64), priceUnit: '米', quantityUnitVerified: true } })
    expect(appended[2]).toMatchObject({ materialName: '方管', materialGrade: '', qty: 80, source: { rowNumber: 4 } })
    expect(appended[1]?.id).toBeUndefined()
  })
  it.each(['NaN', 'Infinity', '0x20', '1,200', ''])('非法数量 %s 保持错误原定位，不静默跳行', (qty) => {
    const row = prepared()[0]!
    row.values.qty = qty
    row.values.priceUnit = '米'
    row.verified = true
    expect(materialContractLineImportErrors(row)).toContain('数量必须为大于 0 的有限数值')
    expect(() => appendMaterialContractLineImport([], [row])).toThrow('第 2 行')
  })
  it('根与米未明确换算前阻止追加；真实零单价可核实通过，未知单价不能', () => {
    const row = prepared()[0]!
    row.values.unit = '根'
    row.values.priceUnit = '米'
    row.verified = true
    expect(materialContractLineImportErrors(row)).toContain('计量单位与计价单位不同，请按原依据修正数量和单位后核对')
    row.values.unit = '米'
    row.values.taxInclusiveUnitPrice = '0'
    expect(appendMaterialContractLineImport([], [row])[0]?.taxInclusiveUnitPrice).toBe(0)
    row.values.taxInclusiveUnitPrice = ''
    expect(() => appendMaterialContractLineImport([], [row])).toThrow('含税单价')
  })
})
