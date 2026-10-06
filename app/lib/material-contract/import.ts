import type { ContractLineItemDraft } from '../contract/forms'
import type { ImportMapping, ImportTemplateField } from '../kit/import-mapping'
import type { RawImportSheet } from '../util/excel'
import { isISODateDTO } from '../../types/read-model'
import { buildImportRows, EXTERNAL_REF_FIELD } from '../kit/import-mapping'

export const MATERIAL_CONTRACT_LINE_IMPORT_FIELDS: readonly ImportTemplateField[] = [
  { key: 'materialName', label: '材料名称', required: true, aliases: ['物资名称'] },
  { key: 'spec', label: '规格', aliases: ['规格型号'] },
  { key: 'materialGrade', label: '材质' },
  { key: 'brand', label: '品牌' },
  { key: 'unit', label: '单位', aliases: ['计量单位'] },
  { key: 'qty', label: '数量', required: true },
  { key: 'taxInclusiveUnitPrice', label: '含税单价', required: true },
  { key: 'priceUnit', label: '计价单位', aliases: ['单价单位'] },
  { key: 'plannedArrivalDate', label: '计划到货日期' },
  { key: 'note', label: '备注' },
  EXTERNAL_REF_FIELD,
]

export interface MaterialContractLineImportRow {
  values: Record<string, string>
  source: { fileName: string, sheetName: string, rowNumber: number, sourceHash: string }
  verified: boolean
}

export function prepareMaterialContractLineImport(sheet: RawImportSheet, mapping: ImportMapping): MaterialContractLineImportRow[] {
  return buildImportRows(mapping, sheet.rows).map((row, index) => ({
    values: Object.fromEntries(MATERIAL_CONTRACT_LINE_IMPORT_FIELDS.map(field => [field.key, String(row[field.key] ?? '')])),
    source: { fileName: sheet.sourceFileName ?? '', sheetName: sheet.name, rowNumber: sheet.rowNumbers?.[index] ?? sheet.headerRow + index + 2, sourceHash: sheet.sourceHash ?? '' },
    verified: false,
  }))
}

function decimal(value: string): number | null {
  const text = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export function materialContractLineImportErrors(row: MaterialContractLineImportRow): string[] {
  const values = row.values
  const errors: string[] = []
  if (!values.materialName?.trim())
    errors.push('材料名称未填写')
  const qty = decimal(values.qty ?? '')
  if (qty == null || qty <= 0)
    errors.push('数量必须为大于 0 的有限数值')
  const price = decimal(values.taxInclusiveUnitPrice ?? '')
  if (price == null || price < 0)
    errors.push('含税单价必须为非负有限数值')
  if (!values.unit?.trim())
    errors.push('计量单位未填写')
  if (!values.priceUnit?.trim())
    errors.push('计价单位待核对填写')
  if (values.unit?.trim() && values.priceUnit?.trim() && values.unit.trim() !== values.priceUnit.trim())
    errors.push('计量单位与计价单位不同，请按原依据修正数量和单位后核对')
  if (values.plannedArrivalDate?.trim() && !isISODateDTO(values.plannedArrivalDate.trim()))
    errors.push('计划到货日期须为 YYYY-MM-DD')
  if (!row.verified)
    errors.push('数量、计量单位及计价单位未核实')
  if (!row.source.fileName || !row.source.sourceHash)
    errors.push('来源文件证据缺失')
  return errors
}

/** 整批通过才返回新草稿；不触发逐行入库、不按名称覆盖、不分配正式 ID。 */
export function appendMaterialContractLineImport(existing: readonly ContractLineItemDraft[], rows: readonly MaterialContractLineImportRow[]): ContractLineItemDraft[] {
  if (!rows.length)
    throw new Error('工作表没有可追加材料行')
  for (const row of rows) {
    const errors = materialContractLineImportErrors(row)
    if (errors.length)
      throw new Error(`${row.source.sheetName} 第 ${row.source.rowNumber} 行：${errors.join('；')}`)
  }
  return [...existing.map(row => ({ ...row, ...(row.source ? { source: { ...row.source } } : {}) })), ...rows.map(row => ({
    materialName: row.values.materialName!.trim(),
    spec: row.values.spec ?? '',
    materialGrade: row.values.materialGrade ?? '',
    brand: row.values.brand ?? '',
    unit: row.values.unit!.trim(),
    qty: decimal(row.values.qty!)!,
    taxInclusiveUnitPrice: decimal(row.values.taxInclusiveUnitPrice!)!,
    plannedArrivalDate: row.values.plannedArrivalDate?.trim() ?? '',
    note: row.values.note ?? '',
    source: { ...row.source, externalRef: row.values.externalRef?.trim() || null, priceUnit: row.values.priceUnit!.trim(), quantityUnitVerified: true },
  }))]
}
