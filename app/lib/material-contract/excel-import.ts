import type { ContractLineItemDraft, ProjectContractFormDraft } from '../contract/forms'
import type { RawImportWorkbook } from '../util/excel'
import { isISODateDTO } from '../../types/read-model'
import { appendMaterialContractLineImport } from './import'
import { materialContractTotal } from './line-model'

export interface MaterialExcelGroup {
  key: string
  rowNumber: number
  projectName: string
  supplierName: string
  constructionName: string
  signatoryName: string
  draft: ProjectContractFormDraft
  lineItems: ContractLineItemDraft[]
}
const headerFields: Record<string, keyof ProjectContractFormDraft> = {
  合同编号: 'no',
  合同名称: 'name',
  合同内容: 'content',
  开票类型: 'invoiceType',
  联系人: 'contactName',
  联系电话: 'contactPhone',
  税率: 'taxRate',
  签约日期: 'signDate',
  付款条款: 'paymentTerms',
  主要条款: 'mainTerms',
  品牌质量条款: 'brandQualityTerms',
  进度条款: 'scheduleTerms',
  保修条款: 'warrantyTerms',
  特别条款: 'specialTerms',
  质保金比例: 'retentionRatio',
  质保金金额: 'retentionAmount',
  质保期天数: 'retentionDays',
  含税合同金额: 'amount',
  备注: 'note',
}
export function materialExcelFieldLabel(key: string): string {
  return Object.entries(headerFields).find(([, field]) => field === key)?.[0] ?? key
}
const numbers = new Set(['taxRate', 'retentionRatio', 'retentionAmount', 'retentionDays', 'amount'])
const text = (value: unknown) => String(value ?? '').trim()
function number(value: string, label: string, ratio = false, percentagePoints = false): number {
  const percent = value.endsWith('%')
  if (percent && !ratio && !percentagePoints)
    throw new Error(`${label}不能填写百分数`)
  const raw = Number(percent ? value.slice(0, -1).trim() : value)
  const result = percent && ratio ? raw / 100 : raw
  if (!Number.isFinite(result) || result < 0 || (ratio && result > 1))
    throw new Error(`${label}不是有效的非负数${ratio ? '或 0%–100% 比例' : ''}`)
  return result
}

/** 两张工作表用文件内分组号对应；不按合同名称或近似金额猜合并。 */
export function prepareMaterialExcelWorkbook(workbook: RawImportWorkbook): MaterialExcelGroup[] {
  const header = workbook.sheets.find(sheet => sheet.name === '合同主档')
  const lines = workbook.sheets.find(sheet => sheet.name === '采购明细')
  if (!header || !lines || !header.sourceHash || !header.sourceFileName || header.sourceHash !== lines.sourceHash || header.sourceFileName !== lines.sourceFileName)
    throw new Error('需要同一工作簿的“合同主档”和“采购明细”及完整文件来源')
  const groups = new Map<string, MaterialExcelGroup>()
  for (const [index, row] of header.rows.entries()) {
    const key = text(row.导入分组号)
    if (!key || groups.has(key))
      throw new Error('每条合同必须填写唯一的导入分组号')
    const projectName = text(row.项目名称)
    const supplierName = text(row.分供方名称)
    const constructionName = text(row.施工主合同名称或编号)
    const signatoryName = text(row.我方签约主体)
    if (!text(row.合同名称) || !projectName || !supplierName || !constructionName)
      throw new Error(`合同主档第 ${header.rowNumbers?.[index] ?? index + 2} 行须填写合同、项目、施工主合同及分供方名称`)
    const draft: Record<string, unknown> = {}
    for (const [column, field] of Object.entries(headerFields)) {
      const value = text(row[column])
      if (!value)
        continue
      if (numbers.has(field)) {
        draft[field] = number(value, column, field === 'retentionRatio', field === 'taxRate')
      }
      else if (field === 'signDate') {
        if (!isISODateDTO(value))
          throw new Error('签约日期须为 YYYY-MM-DD')
        draft[field] = value
      }
      else {
        draft[field] = value
      }
    }
    groups.set(key, { key, rowNumber: header.rowNumbers?.[index] ?? index + 2, projectName, supplierName, constructionName, signatoryName, draft: draft as ProjectContractFormDraft, lineItems: [] })
  }
  if (!groups.size)
    throw new Error('合同主档没有可导入的数据')
  for (const [index, row] of lines.rows.entries()) {
    const key = text(row.导入分组号)
    const group = groups.get(key)
    const rowNumber = lines.rowNumbers?.[index] ?? index + 2
    if (!key || !group)
      throw new Error(`采购明细第 ${rowNumber} 行未找到唯一合同分组`)
    const rowData = {
      materialName: text(row.物资名称),
      spec: text(row.规格),
      materialGrade: text(row.材质),
      brand: text(row.品牌),
      unit: text(row.计量单位),
      qty: text(row.数量),
      taxInclusiveUnitPrice: text(row.含税单价),
      priceUnit: text(row.计价单位),
      plannedArrivalDate: text(row.计划到货日期),
      note: text(row.备注),
      externalRef: text(row.外部旧ID),
    }
    const verified = ['是', 'true', '1'].includes(text(row.数量及单位已核实).toLocaleLowerCase('zh-CN'))
    group.lineItems = appendMaterialContractLineImport(group.lineItems, [{ values: rowData, verified, source: { fileName: header.sourceFileName, sheetName: lines.name, rowNumber, sourceHash: header.sourceHash } }])
  }
  for (const group of groups.values()) {
    if (group.lineItems.length && group.draft.amount != null) {
      const total = materialContractTotal(group.lineItems, [])
      if (total == null || Math.abs(total - group.draft.amount) > 0.005)
        throw new Error(`合同主档第 ${group.rowNumber} 行金额与采购明细不一致，请核对原文及减项`)
    }
  }
  return [...groups.values()]
}
