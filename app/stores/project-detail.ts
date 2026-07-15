import type { ProjectDetailAggregate } from '~/lib/project/detail-aggregate'
import type { ProjectOperationSummary } from '~/lib/project/detail-summary'
import { db } from '~/lib/db/client'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import { loadProjectDetailAggregates } from '~/lib/project/detail-aggregate'

export interface ConstructionContractRow {
  id: string
  projectId: string
  name: string
  contractNo: string
  amount: number
  status: string
  signDate: string
  category: string
  signedAmount: number
}

export interface SupplementAgreementRow {
  id: string
  contractId: string
  projectId: string
  name: string
  amount: number
  signDate: string
}

export interface OwnerChangeOrderRow {
  id: string
  projectId: string
  changeNo: string
  contractName: string
  taxIncAmount: number
  taxExcAmount: number
  appliedAmount: number
  approvalDate: string
}

export interface InvoiceApplicationRow {
  id: string
  projectId: string
  name: string
  amount: number
  taxRate: number
  taxAmount: number
  status: string
  invoiceDate: string
}

export interface ReceiptRegistrationRow {
  id: string
  projectId: string
  receiptNo: string
  receiptDate: string
  amount: number
  paymentMethod: string
  payerUnit: string
  cumulativeReceivable: number
}

export interface PaymentApplicationRow {
  id: string
  projectId: string
  applicationNo: string
  approvalStatus: string
  applicant: string
  amount: number
  paidAmount: number
  paymentMethod: string
  actualPayment: number
  acceptor: string
}

export interface CurrentReceiptRow {
  id: string
  projectId: string
  receiptNo: string
  receiptDate: string
  amount: number
  payer: string
}

export interface CurrentPaymentRow {
  id: string
  projectId: string
  paymentNo: string
  approvalStatus: string
  paymentDate: string
  payee: string
  amount: number
  paymentMethod: string
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const useProjectDetailStore = defineStore('project-detail', () => {
  const constructionContracts = shallowRef<ConstructionContractRow[]>([])
  const supplementAgreements = shallowRef<SupplementAgreementRow[]>([])
  const ownerChangeOrders = shallowRef<OwnerChangeOrderRow[]>([])
  const invoiceApplications = shallowRef<InvoiceApplicationRow[]>([])
  const receiptRegistrations = shallowRef<ReceiptRegistrationRow[]>([])
  const paymentApplications = shallowRef<PaymentApplicationRow[]>([])
  const currentReceipts = shallowRef<CurrentReceiptRow[]>([])
  const currentPayments = shallowRef<CurrentPaymentRow[]>([])
  const aggregateRows = shallowRef<ProjectDetailAggregate[]>([])
  const loading = shallowRef(false)
  const loaded = shallowRef(false)

  const operationSummaries = computed<Record<string, ProjectOperationSummary>>(() => Object.fromEntries(
    aggregateRows.value.map(({ projectId, outputAmount: _, outputTax: __, ...summary }) => [projectId, summary]),
  ))
  const invoiceOutputSummaries = computed<Record<string, { outputAmount: number, outputTax: number }>>(() => Object.fromEntries(
    aggregateRows.value.map(row => [row.projectId, { outputAmount: row.outputAmount, outputTax: row.outputTax }]),
  ))

  async function load(force = false) {
    if (loaded.value && !force)
      return
    loading.value = true
    try {
      const [contracts, supplements, changes, outgoing, receipts, payments, currentIn, currentOut, aggregates] = await Promise.all([
        select<Record<string, unknown>>(selectVisibleSql('construction_contracts', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('supplement_agreements', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('owner_change_orders', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('invoice_applications', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('receipt_registrations', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('payment_applications', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('current_receipts', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('current_payments', 'ORDER BY created_at DESC')),
        loadProjectDetailAggregates(db),
      ])

      constructionContracts.value = contracts.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        name: (row.name ?? '') as string,
        contractNo: (row.contract_no ?? '') as string,
        amount: number(row.amount),
        status: (row.status ?? '') as string,
        signDate: (row.sign_date ?? '') as string,
        category: (row.category ?? '') as string,
        signedAmount: number(row.signed_amount),
      }))
      const contractProjects = new Map(constructionContracts.value.map(row => [row.id, row.projectId]))
      supplementAgreements.value = supplements.map(row => ({
        id: row.id as string,
        contractId: row.contract_id as string,
        projectId: contractProjects.get(row.contract_id as string) ?? '',
        name: (row.name ?? '') as string,
        amount: number(row.amount),
        signDate: (row.sign_date ?? '') as string,
      }))
      ownerChangeOrders.value = changes.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        changeNo: (row.change_no ?? '') as string,
        contractName: (row.contract_name ?? '') as string,
        taxIncAmount: number(row.tax_inc_amount),
        taxExcAmount: number(row.tax_exc_amount),
        appliedAmount: number(row.applied_amount),
        approvalDate: (row.approval_date ?? '') as string,
      }))
      invoiceApplications.value = outgoing.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        name: (row.name ?? '') as string,
        amount: number(row.amount),
        taxRate: number(row.tax_rate),
        taxAmount: number(row.tax_amount),
        status: (row.status ?? '') as string,
        invoiceDate: (row.invoice_date ?? '') as string,
      }))
      receiptRegistrations.value = receipts.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        receiptNo: (row.receipt_no ?? '') as string,
        receiptDate: (row.receipt_date ?? '') as string,
        amount: number(row.amount),
        paymentMethod: (row.payment_method ?? '') as string,
        payerUnit: (row.payer_unit ?? '') as string,
        cumulativeReceivable: number(row.cumulative_receivable),
      }))
      paymentApplications.value = payments.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        applicationNo: (row.application_no ?? '') as string,
        approvalStatus: (row.approval_status ?? '') as string,
        applicant: (row.applicant ?? '') as string,
        amount: number(row.amount),
        paidAmount: number(row.paid_amount),
        paymentMethod: (row.payment_method ?? '') as string,
        actualPayment: number(row.actual_payment),
        acceptor: (row.acceptor ?? '') as string,
      }))
      currentReceipts.value = currentIn.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        receiptNo: (row.receipt_no ?? '') as string,
        receiptDate: (row.receipt_date ?? '') as string,
        amount: number(row.amount),
        payer: (row.payer ?? '') as string,
      }))
      currentPayments.value = currentOut.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        paymentNo: (row.payment_no ?? '') as string,
        approvalStatus: (row.approval_status ?? '') as string,
        paymentDate: (row.payment_date ?? '') as string,
        payee: (row.payee ?? '') as string,
        amount: number(row.amount),
        paymentMethod: (row.payment_method ?? '') as string,
      }))
      aggregateRows.value = aggregates
      loaded.value = true
    }
    finally {
      loading.value = false
    }
  }

  return {
    constructionContracts: readonly(constructionContracts),
    supplementAgreements: readonly(supplementAgreements),
    ownerChangeOrders: readonly(ownerChangeOrders),
    invoiceApplications: readonly(invoiceApplications),
    receiptRegistrations: readonly(receiptRegistrations),
    paymentApplications: readonly(paymentApplications),
    currentReceipts: readonly(currentReceipts),
    currentPayments: readonly(currentPayments),
    operationSummaries,
    invoiceOutputSummaries,
    loading: readonly(loading),
    load,
  }
})
