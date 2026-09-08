import type { KitTableColumn } from '~/lib/kit/table'
import { matchesEnumFilter } from '~/lib/kit/enum-filter'

export type ContractAuxListKind
  = 'other_expense'
    | 'company_expense'
    | 'other_settlement'
    | 'material_settlement'

export interface ContractAuxRow {
  id: string
  no: string
  name: string
  projectId: string
  projectName: string
  supplierId: string
  supplierName: string
  contractId: string
  contractName: string
  category: string
  counterparty: string
  period: string
  amount: number
  date: string
  status: string
}

export interface ContractAuxListFilters {
  search: string
  project: string | string[]
  category: string | string[]
  status: string | string[]
  routeProject?: string
  routeContract?: string
  routeSupplier?: string
}

interface ContractAuxListConfig {
  columns: KitTableColumn[]
  searchFields: Array<keyof ContractAuxRow>
  searchPlaceholder: string
  countLabel: string
  amountLabel: string
  showProjectFilter: boolean
  showCategoryFilter: boolean
}

const ACTION_COLUMN: KitTableColumn = { title: '操作', type: 'action', width: 56 }
const SEQ_COLUMN: KitTableColumn = { title: '#', type: 'seq', width: 54, fixed: 'left' }

export const CONTRACT_AUX_LIST_CONFIG: Record<ContractAuxListKind, ContractAuxListConfig> = {
  company_expense: {
    columns: [
      SEQ_COLUMN,
      { field: 'name', title: '合同名称', minWidth: 220, fixed: 'left', slot: 'name' },
      { field: 'no', title: '合同编号', width: 150 },
      { field: 'category', title: '类别', width: 110 },
      { field: 'counterparty', title: '对方单位', minWidth: 180 },
      { field: 'amount', title: '合同金额', type: 'money', width: 140 },
      { field: 'date', title: '签订日期', type: 'date', width: 110 },
      { field: 'period', title: '合同期', width: 130 },
      { field: 'status', title: '状态', width: 96, slot: 'status' },
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'counterparty'],
    searchPlaceholder: '搜索合同名称 / 编号 / 对方单位',
    countLabel: '合同数',
    amountLabel: '合同金额总和',
    showProjectFilter: false,
    showCategoryFilter: true,
  },
  other_expense: {
    columns: [
      SEQ_COLUMN,
      { field: 'name', title: '合同名称', minWidth: 210, fixed: 'left', slot: 'name' },
      { field: 'no', title: '合同编号', width: 150 },
      { field: 'projectName', title: '项目', width: 150, slot: 'project' },
      { field: 'category', title: '类别', width: 110 },
      { field: 'supplierName', title: '对方单位', minWidth: 170, slot: 'supplier' },
      { field: 'amount', title: '合同金额', type: 'money', width: 140 },
      { field: 'date', title: '签订日期', type: 'date', width: 110 },
      { field: 'status', title: '状态', width: 96, slot: 'status' },
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'supplierName'],
    searchPlaceholder: '搜索合同名称 / 编号 / 对方单位',
    countLabel: '合同数',
    amountLabel: '合同金额总和',
    showProjectFilter: true,
    showCategoryFilter: true,
  },
  other_settlement: {
    columns: [
      SEQ_COLUMN,
      { field: 'name', title: '结算名称', minWidth: 210, fixed: 'left', slot: 'name' },
      { field: 'no', title: '结算单号', width: 160 },
      { field: 'projectName', title: '项目', width: 150, slot: 'project' },
      { field: 'supplierName', title: '分供方', minWidth: 170, slot: 'supplier' },
      { field: 'contractName', title: '其他支出合同', minWidth: 190, slot: 'contract' },
      { field: 'amount', title: '结算金额', type: 'money', width: 150 },
      { field: 'date', title: '结算日期', type: 'date', width: 110 },
      { field: 'status', title: '状态', width: 96, slot: 'status' },
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'contractName', 'supplierName'],
    searchPlaceholder: '搜索结算名称 / 单号 / 源合同',
    countLabel: '结算数',
    amountLabel: '结算金额总和',
    showProjectFilter: true,
    showCategoryFilter: false,
  },
  material_settlement: {
    columns: [
      SEQ_COLUMN,
      { field: 'name', title: '结算名称', minWidth: 210, fixed: 'left', slot: 'name' },
      { field: 'no', title: '结算单号', width: 160 },
      { field: 'projectName', title: '项目', width: 150, slot: 'project' },
      { field: 'supplierName', title: '分供方', minWidth: 180, slot: 'supplier' },
      { field: 'contractName', title: '采购合同', minWidth: 190, slot: 'contract' },
      { field: 'amount', title: '结算金额', type: 'money', width: 150 },
      { field: 'date', title: '结算日期', type: 'date', width: 110 },
      { field: 'status', title: '状态', width: 96, slot: 'status' },
      ACTION_COLUMN,
    ],
    searchFields: ['no', 'name', 'contractName', 'supplierName'],
    searchPlaceholder: '搜索结算名称 / 单号 / 采购合同',
    countLabel: '结算单数',
    amountLabel: '结算金额总和',
    showProjectFilter: true,
    showCategoryFilter: false,
  },
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN')
}

export function filterContractAuxRows(
  kind: ContractAuxListKind,
  rows: readonly ContractAuxRow[],
  filters: ContractAuxListFilters,
): ContractAuxRow[] {
  const config = CONTRACT_AUX_LIST_CONFIG[kind]
  const keyword = normalized(filters.search)
  return rows.filter((row) => {
    if (!matchesEnumFilter(row.projectId, filters.project))
      return false
    if (!matchesEnumFilter(row.category, filters.category))
      return false
    if (!matchesEnumFilter(row.status, filters.status))
      return false
    if (filters.routeProject && row.projectId !== filters.routeProject)
      return false
    if (filters.routeContract && row.contractId !== filters.routeContract)
      return false
    if (filters.routeSupplier && row.supplierId !== filters.routeSupplier)
      return false
    if (!keyword)
      return true
    return config.searchFields.some(field => normalized(row[field]).includes(keyword))
  })
}

export function contractAuxStatusClass(status: string): string {
  if (['已确认', '已结清', '履约中'].includes(status))
    return status === '履约中' ? 'chip-brand' : 'chip-ok'
  if (['待确认', '审批中'].includes(status))
    return 'chip-warn'
  return 'chip bg-surface-3 text-ink-faint'
}
