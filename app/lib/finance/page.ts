import type {
  CurrentTransactionFormDraft,
  ExpenseReimbursementFormDraft,
  F3FormDraft,
  F3FormKind,
  F3SaveAction,
  InvoiceApplicationFormDraft,
  PaymentApplicationFormDraft,
  PaymentRecordFormDraft,
  ReceiptFormDraft,
} from '~/lib/finance/forms'
import type { DataOriginDTO } from '~/types/read-model'

export type FinancePageDraft
  = ReceiptFormDraft
    & InvoiceApplicationFormDraft
    & CurrentTransactionFormDraft
    & ExpenseReimbursementFormDraft
    & PaymentApplicationFormDraft
    & PaymentRecordFormDraft

export const PAYMENT_BIZ_TYPES = [
  '有合同-合同劳务',
  '有合同-材料',
  '有合同-专业分包',
  '有合同-机械',
  '有合同-其他',
  '无合同-零星采购',
  '预付款',
  '管理费',
  '项目费用',
  '公司付款',
]

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
  if (kind === 'receipt' && id)
    return `${base}/form/${id}`
  return id ? `${base}/${id}` : `${base}/new`
}

export function financeDetailPath(kind: F3FormKind, id: string): string {
  if (kind === 'receipt')
    throw new Error('收款只读详情必须使用 receiptDetailPath 并携带来源身份')
  if (kind === 'payment_application')
    return `/finance/payment/${id}/detail`
  return financeFormPath(kind, id)
}

export function receiptDetailPath(id: string, context: {
  origin: DataOriginDTO
  customerId: string
}): string {
  if (!id.trim() || !context.customerId.trim())
    throw new Error('收款只读详情缺少稳定身份')
  return `/finance/receipt/${encodeURIComponent(id)}?origin=${context.origin}&customerId=${encodeURIComponent(context.customerId)}`
}

export function validateFinanceForm(
  kind: F3FormKind,
  draft: FinancePageDraft,
  action: F3SaveAction,
): Record<string, string> {
  const errors: Record<string, string> = {}
  const require = (field: keyof FinancePageDraft, label: string, positive = false) => {
    const value = draft[field]
    const missing = positive
      ? !(Number(value) > 0)
      : typeof value === 'string'
        ? !value.trim()
        : value == null
    if (missing)
      errors[String(field)] = `${label}为必填项`
  }

  switch (kind) {
    case 'receipt':
      require('receiptDate', '收款日期')
      require('projectId', '项目')
      require('customerId', '客户')
      require('amount', '收款金额', true)
      break
    case 'invoice_application':
      require('name', '开票申请名称')
      require('projectId', '项目')
      require('customerId', '客户')
      require('buyerNameSnapshot', '购方名称')
      require('buyerTaxNoSnapshot', '购方税号')
      require('applicationDate', '申请日期')
      require('amount', '申请金额', true)
      break
    case 'current':
      require('direction', '收付方向')
      require('projectId', '项目')
      require('counterparty', '往来单位')
      require('transactionDate', '发生日期')
      require('amount', '发生金额', true)
      break
    case 'reimbursement':
      require('applicant', '报销人')
      require('reimbursementDate', '报销日期')
      if (!(draft.lines?.length)
        || draft.lines.some(line => !line.expenseItem?.trim() || !(Number(line.amount) > 0))) {
        errors.lines = '费用明细项目和金额为必填项'
      }
      break
    case 'payment_application':
      require('name', '付款申请名称')
      require('bizType', '业务类型')
      require('applyAmount', '申请金额', true)
      require('applyDate', '申请日期')
      require('applicant', '申请人')
      require('invoiceState', '回票类型')
      if (draft.bizType !== '公司付款')
        require('projectId', '项目')
      if (draft.bizType?.startsWith('有合同-') || draft.bizType === '预付款') {
        require('supplierId', '收款单位')
        require('contractId', '关联合同')
      }
      break
    case 'payment_record':
      require('payeeName', '收款方名称')
      require('paymentDate', '支付日期')
      require('amount', '支付金额', true)
      require('voucherNo', '付款凭证号')
      require('bankSerialNo', '银行流水号')
      if (action === 'confirm')
        require('confirmedBy', '确认人')
      break
  }

  return errors
}
