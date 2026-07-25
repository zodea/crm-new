import type {
  ExpenseReimbursementFormDraft,
  F3FormDraft,
  F3FormKind,
  PaymentApplicationFormDraft,
  PaymentRecordFormDraft,
} from '~/lib/finance/forms'

export interface FinanceFormMeta {
  label: string
  subtitle: string
  listPath: string
  newPath: string
  sections: Array<{ key: string, label: string }>
}

export const F3_FORM_META: Record<F3FormKind, FinanceFormMeta> = {
  receipt: {
    label: '收款登记',
    subtitle: '合同收款事实 · 真实项目/施工合同/客户',
    listPath: '/finance/receipt',
    newPath: '/finance/receipt/new',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '金额与方式' },
      { key: 'attachments', label: '凭证与备注' },
    ],
  },
  invoice_application: {
    label: '开票申请',
    subtitle: '收入侧开票起点 · 购方信息提交快照',
    listPath: '/finance/billing',
    newPath: '/finance/billing/new',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '金额与税率' },
      { key: 'attachments', label: '经办与附件' },
    ],
  },
  current: {
    label: '往来收付',
    subtitle: '非合同往来 · 收付方向统一台账',
    listPath: '/finance/current',
    newPath: '/finance/current/new',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '金额与方式' },
      { key: 'attachments', label: '凭证与备注' },
    ],
  },
  payment_record: {
    label: '支付记录',
    subtitle: '银行实际支付 · 多付款申请分摊 · 人工确认',
    listPath: '/finance/records',
    newPath: '/finance/records/new',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '支付与账户' },
      { key: 'allocations', label: '付款申请分摊' },
      { key: 'review', label: '识别与核对' },
      { key: 'attachments', label: '回单与备注' },
    ],
  },
  reimbursement: {
    label: '费用报销',
    subtitle: '报销头 + 费用明细 · 公司开支允许空项目',
    listPath: '/finance/reimbursement',
    newPath: '/finance/reimbursement/new',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'lines', label: '费用明细' },
      { key: 'attachments', label: '票据与备注' },
    ],
  },
  payment_application: {
    label: '付款申请',
    subtitle: '10 类业务 · 真实结算/发票勾稽',
    listPath: '/finance/payment',
    newPath: '/finance/payment/new',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'settlements', label: '关联结算' },
      { key: 'invoices', label: '关联发票' },
      { key: 'approval', label: '审批与支付' },
      { key: 'attachments', label: '附件与备注' },
    ],
  },
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function f3FormDefaults(kind: F3FormKind): F3FormDraft {
  switch (kind) {
    case 'receipt':
      return {
        receiptDate: today(),
        projectId: null,
        contractId: null,
        customerId: null,
        amount: 0,
        paymentMethod: '银行转账',
        status: 'draft',
      }
    case 'invoice_application':
      return {
        projectId: null,
        contractId: null,
        customerId: null,
        amount: 0,
        taxRate: 9,
        taxAmount: 0,
        applicationDate: today(),
        status: 'draft',
      }
    case 'current':
      return {
        direction: 'receipt',
        projectId: null,
        amount: 0,
        paymentMethod: '银行转账',
        transactionDate: today(),
        status: 'draft',
      }
    case 'reimbursement':
      return {
        projectId: null,
        reimbursementDate: today(),
        invoiceCount: 0,
        status: 'draft',
        lines: [{
          expenseItem: '',
          expenseDate: today(),
          amount: 0,
          note: '',
        }],
      } satisfies ExpenseReimbursementFormDraft
    case 'payment_application':
      return {
        bizType: '有合同-材料',
        projectId: null,
        supplierId: null,
        contractId: null,
        costName: '材料',
        applyAmount: 0,
        applyDate: today(),
        invoiceState: '先款后票',
        prepayDeduct: 0,
        approvedAmount: 0,
        status: 'draft',
        settlementAllocations: [],
        invoiceAllocations: [],
      } satisfies PaymentApplicationFormDraft
    case 'payment_record':
      return {
        projectId: null,
        supplierId: null,
        paymentDate: today(),
        amount: 0,
        paymentMethod: '银行转账',
        source: 'manual',
        recognitionStatus: 'not_applicable',
        ocrPayload: {},
        fieldConfidence: {},
        confirmationStatus: 'draft',
        confirmedBy: '',
        applicationAllocations: [],
      } satisfies PaymentRecordFormDraft
  }
}

export function financeFormPath(kind: F3FormKind, id?: string): string {
  const base = F3_FORM_META[kind].listPath
  return id ? `${base}/${id}` : `${base}/new`
}
