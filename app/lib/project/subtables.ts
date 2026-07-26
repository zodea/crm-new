export type ProjectDetailTabKey
  = 'detail'
    | 'budget'
    | 'construction'
    | 'expenditure'
    | 'tax'
    | 'fund'
    | 'current'
    | 'payment'
    | 'material'
    | 'acceptance'

export interface ProjectDetailTabDefinition {
  key: ProjectDetailTabKey
  label: string
  kind: 'real' | 'placeholder'
}

export const PROJECT_DETAIL_TABS: readonly ProjectDetailTabDefinition[] = [
  { key: 'detail', label: '详细资料', kind: 'real' },
  { key: 'budget', label: '成本预算', kind: 'real' },
  { key: 'construction', label: '施工合同管理', kind: 'real' },
  { key: 'expenditure', label: '支出合同管理', kind: 'real' },
  { key: 'tax', label: '票税管理', kind: 'real' },
  { key: 'fund', label: '资金管理', kind: 'real' },
  { key: 'current', label: '往来款', kind: 'placeholder' },
  { key: 'payment', label: '支付明细', kind: 'placeholder' },
  { key: 'material', label: '物资管理', kind: 'placeholder' },
  { key: 'acceptance', label: '竣工验收及保修', kind: 'placeholder' },
] as const

interface InvoiceOwnership {
  projectId: string | null
  accountStatus: string
}

/** 收票登记以台账终态为准：只展示已归档且明确归属当前项目的发票。 */
export function projectArchivedInvoices<T extends InvoiceOwnership>(
  invoices: readonly T[],
  projectId: string,
): T[] {
  return invoices.filter(invoice =>
    invoice.accountStatus === 'archived' && invoice.projectId === projectId,
  )
}
