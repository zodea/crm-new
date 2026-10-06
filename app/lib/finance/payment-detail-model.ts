import type { ApprovedAmountOrigin, ApprovedAmountState } from './approval-amount'
import type { InvoiceState } from './domain'
import { approvalPaymentCap } from './approval-amount'
import { needsSettlementAllocation, pendingInvoiceAmountForRead } from './domain'

const EPSILON = 0.0001

export type PaymentInsightLevel = 'ok' | 'info' | 'warn' | 'danger'

export interface PaymentApplicationInsightInput {
  status: string
  bizType: string
  workerId?: string | null
  hasSettlementAllocations?: boolean
  invoiceState: InvoiceState | string
  applyAmount: number
  approvedAmount: number | null
  approvedAmountOrigin?: ApprovedAmountOrigin
  settlementAllocated: number
  invoiceAllocated: number
  paidAmount: number
}

export interface PaymentApplicationInsightCheck {
  key: 'approval' | 'settlement' | 'invoice' | 'payment'
  title: string
  level: PaymentInsightLevel
  summary: string
  detail: string
}

export interface PaymentApplicationInsight {
  attentionCount: number
  checks: PaymentApplicationInsightCheck[]
}

export interface PaymentApplicationSettlementDetail {
  sourceState?: 'readable' | 'frozen' | 'unavailable' | 'forbidden'
  id: string
  no: string
  name: string
  totalAmount: number | null
  settlementDate: string
  status: string
  allocatedAmount: number
  note: string
}

export interface PaymentApplicationInvoiceDetail {
  sourceState?: 'readable' | 'frozen' | 'unavailable' | 'forbidden'
  id: string
  invoiceNumber: string
  invoiceDate: string
  totalAmount: number | null
  allocatedAmount: number
  note: string
}

export interface PaymentApplicationPaymentDetail {
  id: string
  no: string
  payeeName: string
  paymentDate: string
  amount: number
  confirmationStatus: string
  allocatedAmount: number
  voucherNo: string
}

export interface PaymentApplicationDetail {
  id: string
  no: string
  name: string
  bizType: string
  projectId: string | null
  projectName: string
  supplierId: string | null
  supplierName: string
  workerId?: string | null
  canEdit?: boolean
  canRegisterPayment?: boolean
  contractTarget?: string | null
  contractSourceState?: 'readable' | 'frozen' | 'unavailable' | 'forbidden'
  paymentSourceState?: 'readable' | 'forbidden'
  contractId: string | null
  contractNo: string
  contractName: string
  contractAmount: number | null
  contractSettledAmount: number | null
  contractPaidAmount: number | null
  costName: string
  applyAmount: number
  applyDate: string
  applicant: string
  invoiceState: InvoiceState | string
  payContent: string
  prepayDeduct: number
  prepayNote: string
  approvedAmount: number | null
  approvedAmountState: ApprovedAmountState
  approvalNote: string
  status: string
  note: string
  externalRef: string
  createdAt: string
  updatedAt: string
  settlementAllocated: number
  settlementDifference: number
  invoiceAllocated: number
  invoiceDifference: number
  pendingInvoiceAmount: number | null
  paidAmount: number
  unpaidAmount: number | null
  registrationAmount: number
  supplierOtherProjectCount: number | null
  supplierOtherProjectPaidAmount: number | null
  settlements: PaymentApplicationSettlementDetail[]
  invoices: PaymentApplicationInvoiceDetail[]
  payments: PaymentApplicationPaymentDetail[]
  insight: PaymentApplicationInsight
}

export function verifiedPaymentDetailAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('付款金额来源尚未核实，不能读取为零')
  return value
}

export function roundPaymentDetailMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function displayAmount(value: number): string {
  return `¥${value.toFixed(2)}`
}

function isSubmitted(status: string): boolean {
  return ['submitted', 'approved', '已提交', '已审批', '已批复'].includes(status)
}

export function buildPaymentApplicationInsight(
  input: PaymentApplicationInsightInput,
): PaymentApplicationInsight {
  const applyAmount = Math.max(verifiedPaymentDetailAmount(input.applyAmount), 0)
  const settlementAllocated = Math.max(verifiedPaymentDetailAmount(input.settlementAllocated), 0)
  const invoiceAllocated = Math.max(verifiedPaymentDetailAmount(input.invoiceAllocated), 0)
  const paidAmount = Math.max(verifiedPaymentDetailAmount(input.paidAmount), 0)
  const settlementDifference = Math.abs(applyAmount - settlementAllocated)
  const settlementRequired = needsSettlementAllocation(input.bizType, input.hasSettlementAllocations ?? settlementAllocated > 0, input.workerId)
  const pendingInvoiceAmount = pendingInvoiceAmountForRead(input.invoiceState, applyAmount, invoiceAllocated)
  const invoiceMatched = Math.abs(applyAmount - invoiceAllocated) <= EPSILON
  const paymentCap = approvalPaymentCap(applyAmount, input.approvedAmount, input.approvedAmountOrigin)
  const unpaidAmount = paymentCap === null ? null : Math.max(paymentCap - paidAmount, 0)

  const checks: PaymentApplicationInsightCheck[] = [
    {
      key: 'approval',
      title: '申请流程',
      level: isSubmitted(input.status) ? 'ok' : 'warn',
      summary: isSubmitted(input.status) ? '已提交' : '尚未提交',
      detail: isSubmitted(input.status)
        ? '当前记录已进入业务处理阶段。系统暂不伪造审批人和审批时间。'
        : '保存草稿不会进入后续付款处理，请先补齐必填项并保存并提交。',
    },
    {
      key: 'settlement',
      title: '结算勾稽',
      level: !settlementRequired || settlementDifference <= EPSILON ? 'ok' : 'danger',
      summary: !settlementRequired
        ? '该类型无需关联结算'
        : settlementDifference <= EPSILON
          ? '已完全匹配'
          : `差额 ${displayAmount(settlementDifference)}`,
      detail: !settlementRequired
        ? '当前业务类型不以支出结算单作为提交前置条件。'
        : settlementDifference <= EPSILON
          ? `已关联 ${displayAmount(settlementAllocated)}，与申请金额一致。`
          : `已关联 ${displayAmount(settlementAllocated)}，${settlementAllocated > applyAmount ? '超出' : '还缺少'} ${displayAmount(settlementDifference)}；提交前必须核实并匹配真实结算分摊。`,
    },
    {
      key: 'invoice',
      title: '发票勾稽',
      level: input.invoiceState === '无需发票'
        ? invoiceAllocated <= EPSILON ? 'ok' : 'danger'
        : input.invoiceState === '先票后款'
          ? invoiceMatched ? 'ok' : 'danger'
          : pendingInvoiceAmount === null ? 'warn' : pendingInvoiceAmount <= EPSILON ? 'ok' : 'warn',
      summary: input.invoiceState === '无需发票'
        ? invoiceAllocated <= EPSILON ? '无需发票' : '误挂发票'
        : input.invoiceState === '先票后款'
          ? invoiceMatched ? '已完全关联' : '发票分摊尚未匹配'
          : pendingInvoiceAmount === null ? '回票类型待核实' : pendingInvoiceAmount <= EPSILON ? '已完全关联' : `待回票 ${displayAmount(pendingInvoiceAmount)}`,
      detail: input.invoiceState === '无需发票'
        ? invoiceAllocated <= EPSILON
          ? '当前申请明确无需发票，未发现有效发票分摊。'
          : '当前申请标记为无需发票，但仍存在有效发票分摊，请先解除关联。'
        : input.invoiceState === '先票后款'
          ? invoiceMatched ? `已关联 ${displayAmount(invoiceAllocated)} 发票金额。` : `当前申请要求先票后款，发票分摊与申请金额差额为 ${displayAmount(Math.abs(applyAmount - invoiceAllocated))}，请先核实真实关联。`
          : pendingInvoiceAmount === null
            ? '原回票类型尚未核实，不能将未知回票义务读为零。'
            : pendingInvoiceAmount <= EPSILON
              ? `已关联 ${displayAmount(invoiceAllocated)} 发票金额。`
              : `当前回票类型允许后补发票，仍有 ${displayAmount(pendingInvoiceAmount)} 未关联。`,
    },
    paymentCap === null
      ? {
          key: 'payment',
          title: '支付结果',
          level: 'warn',
          summary: '历史批复待核验',
          detail: `已确认支付 ${displayAmount(paidAmount)}。历史批复金额的含义尚不明确，暂不能据此判断余额或是否付清。`,
        }
      : {
          key: 'payment',
          title: '支付结果',
          level: paidAmount > paymentCap + EPSILON
            ? 'danger'
            : (unpaidAmount ?? 0) > EPSILON ? 'info' : 'ok',
          summary: paidAmount > paymentCap + EPSILON
            ? '已付超出可付金额'
            : (unpaidAmount ?? 0) > EPSILON ? `待支付 ${displayAmount(unpaidAmount ?? 0)}` : '已付清',
          detail: paidAmount > paymentCap + EPSILON
            ? `已确认支付 ${displayAmount(paidAmount)}，超过当前可付上限 ${displayAmount(paymentCap)}。`
            : (unpaidAmount ?? 0) > EPSILON
                ? `已确认支付 ${displayAmount(paidAmount)}，当前可付上限为 ${displayAmount(paymentCap)}。`
                : `已确认支付 ${displayAmount(paidAmount)}，当前申请已完成支付。`,
        },
  ]

  return {
    attentionCount: checks.filter(check => check.level === 'warn' || check.level === 'danger').length,
    checks,
  }
}
