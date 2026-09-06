import type { KitTableColumn } from '../kit/table'
import type { AuxiliaryContractDTO, AuxiliaryContractKind } from './contract'
import { yuan } from '../util/money'

export const auxiliaryMoney = (value: string | null) => value === null ? '未记录' : yuan(Number(value))
export function auxiliaryColumns(kind: AuxiliaryContractKind): KitTableColumn[] {
  const money = (field: string, title: string): KitTableColumn => ({ field, title, width: 145 })
  const columns: KitTableColumn[] = [
    { title: '#', type: 'seq', width: 50 },
    { field: 'name', title: '合同名称', minWidth: 230, fixed: 'left', slot: 'name' },
    { field: 'no', title: '合同编号', width: 160 },
    { field: 'category', title: '类别', width: 110 },
  ]
  if (kind === 'other_expense')
    columns.push({ field: 'projectName', title: '项目', width: 165 }, { field: 'supplierName', title: '乙方分供方', width: 180 })
  else columns.push({ field: 'partyA', title: '甲方', width: 170 }, { field: 'counterparty', title: '乙方（对方单位）', width: 180 })
  columns.push(money('contract', '含税合同金额'))
  if (kind === 'other_expense')
    columns.push(money('changed', '变更后合同金额'), money('settled', '累计结算'), money('bySettlementPayable', '按结算应付'))
  else columns.push({ field: 'taxRate', title: '税率', width: 90 }, money('taxExclusive', '无税合同金额'), money('tax', '税额'))
  columns.push(money('invoiced', '累计收票'), money('paid', '累计支付'), money('byInvoicePayable', '按收票应付'), { field: 'status', title: '合同状态', width: 110 }, { field: 'signDate', title: '签订日期', width: 115 }, { field: 'servicePeriod', title: '合同期', width: 140 })
  if (kind === 'other_expense')
    columns.push({ field: 'settlementStatus', title: '结算状态', width: 110 }, { field: 'clearanceStatus', title: '结清状态', width: 110 })
  columns.push({ field: 'invoiceType', title: '发票类型', width: 150 }, { field: 'attachmentSummary', title: '审批稿 / 扫描件 / 附件', width: 240 })
  for (const [field, title] of [['responsible', '负责人'], ['department', '所属部门'], ['createdBy', '创建人'], ['createdAt', '创建时间'], ['updatedBy', '修改人'], ['updatedAt', '修改时间']] as const)
    columns.push({ field, title, width: 160 })
  columns.push({ type: 'action', title: '操作', width: 60, fixed: 'right' })
  return columns
}
export function auxiliaryTableRow(row: AuxiliaryContractDTO) {
  return { ...row.draft, id: row.id, source: row, name: row.draft.name || '未命名合同', projectName: row.project?.state === 'resolved' ? row.project.label : '未记录', supplierName: row.supplier?.state === 'resolved' ? row.supplier.label : '未记录', partyA: row.draft.partyA || '未记录', taxRate: row.draft.taxRate == null ? '未记录' : `${row.draft.taxRate}%`, ...Object.fromEntries(Object.entries(row.amounts).map(([key, value]) => [key, auxiliaryMoney(value)])), settlementStatus: row.settlementStatus || '未记录', clearanceStatus: row.clearanceStatus || '未记录', ...Object.fromEntries(Object.entries(row.audit).map(([key, value]) => [key, value || '未记录'])), attachmentSummary: Object.entries(row.attachmentCategories).map(([category, count]) => `${category} ${count}`).join(' / ') || '无附件' }
}
