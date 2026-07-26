import type { ProjectAcceptanceLifecycleRow } from '~/lib/project/acceptance-lifecycle'
import type {
  TargetCostCategoryRow,
  TargetCostVersionRow,
} from '~/lib/project/cost-control'
import type { ProjectDeliveryArchiveRow } from '~/lib/project/delivery-archive'
import type { ProjectDetailAggregate } from '~/lib/project/detail-aggregate'
import type { ProjectInvoiceSummary, ProjectOperationSummary } from '~/lib/project/detail-summary'
import type {
  ExpenditureContractRow,
  ExpenditureSettlementRow,
  ExpenditureSupplementRow,
  SubcontractChangeRow,
} from '~/lib/project/expenditure-relations'
import type {
  ProjectCurrentTransactionRow,
  ProjectPaymentRecordRow,
} from '~/lib/project/finance-facts'
import { db } from '~/lib/db/client'
import { select } from '~/lib/db/connection'
import { hiddenCtesFor, selectVisibleSql, visibleCond } from '~/lib/db/soft-delete'
import { loadProjectAcceptanceLifecycle } from '~/lib/project/acceptance-lifecycle'
import { loadProjectCostControl } from '~/lib/project/cost-control'
import { loadProjectDeliveryArchive } from '~/lib/project/delivery-archive'
import { loadProjectDetailAggregates } from '~/lib/project/detail-aggregate'
import { loadProjectExpenditureRelations } from '~/lib/project/expenditure-relations'
import { loadProjectFinanceFacts } from '~/lib/project/finance-facts'
import { useInvoiceStore } from '~/stores/invoice'

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

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const useProjectDetailStore = defineStore('project-detail', () => {
  const invoiceStore = useInvoiceStore()
  const constructionContracts = shallowRef<ConstructionContractRow[]>([])
  const supplementAgreements = shallowRef<SupplementAgreementRow[]>([])
  const ownerChangeOrders = shallowRef<OwnerChangeOrderRow[]>([])
  const invoiceApplications = shallowRef<InvoiceApplicationRow[]>([])
  const receiptRegistrations = shallowRef<ReceiptRegistrationRow[]>([])
  const paymentApplications = shallowRef<PaymentApplicationRow[]>([])
  const currentReceipts = shallowRef<ProjectCurrentTransactionRow[]>([])
  const currentPayments = shallowRef<ProjectCurrentTransactionRow[]>([])
  const targetCosts = shallowRef<TargetCostVersionRow[]>([])
  const targetCostCategories = shallowRef<TargetCostCategoryRow[]>([])
  const expenditureContracts = shallowRef<ExpenditureContractRow[]>([])
  const expenditureSupplements = shallowRef<ExpenditureSupplementRow[]>([])
  const subcontractChanges = shallowRef<SubcontractChangeRow[]>([])
  const expenditureSettlements = shallowRef<ExpenditureSettlementRow[]>([])
  const paymentRecords = shallowRef<ProjectPaymentRecordRow[]>([])
  const deliveries = shallowRef<ProjectDeliveryArchiveRow[]>([])
  const acceptances = shallowRef<ProjectAcceptanceLifecycleRow[]>([])
  const aggregateRows = shallowRef<ProjectDetailAggregate[]>([])
  const loading = shallowRef(false)
  const loaded = shallowRef(false)

  const operationSummaries = computed<Record<string, ProjectOperationSummary>>(() => Object.fromEntries(
    aggregateRows.value.map(({ projectId, outputAmount: _, outputTax: __, ...summary }) => [projectId, summary]),
  ))
  const invoiceOutputSummaries = computed<Record<string, { outputAmount: number, outputTax: number }>>(() => Object.fromEntries(
    aggregateRows.value.map(row => [row.projectId, { outputAmount: row.outputAmount, outputTax: row.outputTax }]),
  ))
  const invoiceSummaries = computed<Record<string, ProjectInvoiceSummary>>(() => {
    const projectIds = new Set([
      ...Object.keys(invoiceOutputSummaries.value),
      ...Object.keys(invoiceStore.archivedInvoiceSummaries),
    ])
    return Object.fromEntries([...projectIds].map((projectId) => {
      const output = invoiceOutputSummaries.value[projectId] ?? { outputAmount: 0, outputTax: 0 }
      const input = invoiceStore.archivedInvoiceSummaries[projectId] ?? { inputAmount: 0, inputTax: 0, archivedCount: 0 }
      const vat = output.outputTax - input.inputTax
      return [projectId, {
        ...output,
        ...input,
        vat,
        taxBurdenRate: output.outputAmount === 0 ? 0 : vat / output.outputAmount,
      }]
    }))
  })

  async function load(force = false) {
    if (loaded.value && !force)
      return
    loading.value = true
    try {
      const [
        contracts,
        supplements,
        changes,
        outgoing,
        receipts,
        payments,
        aggregates,
        costControl,
        expenditureRelations,
        financeFacts,
        deliveryArchive,
        acceptanceLifecycle,
      ] = await Promise.all([
        select<Record<string, unknown>>(
          selectVisibleSql('contracts', 'AND kind = ? ORDER BY created_at DESC'),
          ['施工'],
        ),
        select<Record<string, unknown>>(
          selectVisibleSql('contract_supplements', 'ORDER BY created_at DESC'),
        ),
        select<Record<string, unknown>>(selectVisibleSql('owner_change_orders', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('invoice_applications', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(selectVisibleSql('receipt_registrations', 'ORDER BY created_at DESC')),
        select<Record<string, unknown>>(`
          ${hiddenCtesFor(
            'payment_applications',
            'payment_record_application_allocations',
            'payment_records',
          )}
          SELECT application.*,
                 COALESCE((
                   SELECT SUM(allocation.allocated_amount)
                   FROM payment_record_application_allocations AS allocation
                   JOIN payment_records AS payment
                     ON payment.id = allocation.payment_record_id
                   WHERE allocation.payment_application_id = application.id
                     AND ${visibleCond('payment_record_application_allocations', 'allocation')}
                     AND ${visibleCond('payment_records', 'payment')}
                     AND payment.confirmation_status = 'confirmed'
                 ), 0) AS derived_paid_amount
          FROM payment_applications AS application
          WHERE ${visibleCond('payment_applications', 'application')}
          ORDER BY application.created_at DESC
        `),
        loadProjectDetailAggregates(db),
        loadProjectCostControl(db),
        loadProjectExpenditureRelations(db),
        loadProjectFinanceFacts(db),
        loadProjectDeliveryArchive(db),
        loadProjectAcceptanceLifecycle(db),
      ])

      constructionContracts.value = contracts.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        name: (row.name ?? '') as string,
        contractNo: (row.no ?? '') as string,
        amount: number(row.amount),
        status: (row.status ?? '') as string,
        signDate: (row.sign_date ?? '') as string,
        category: (row.kind ?? '') as string,
        signedAmount: number(row.amount),
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
        invoiceDate: (row.application_date ?? '') as string,
      }))
      receiptRegistrations.value = receipts.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        receiptNo: (row.no ?? '') as string,
        receiptDate: (row.receipt_date ?? '') as string,
        amount: number(row.amount),
        paymentMethod: (row.payment_method ?? '') as string,
        payerUnit: (row.payer_account ?? '') as string,
        cumulativeReceivable: number(row.amount),
      }))
      paymentApplications.value = payments.map(row => ({
        id: row.id as string,
        projectId: row.project_id as string,
        applicationNo: (row.no ?? '') as string,
        approvalStatus: (row.status ?? '') as string,
        applicant: (row.applicant ?? '') as string,
        amount: number(row.apply_amount),
        paidAmount: number(row.derived_paid_amount),
        paymentMethod: '',
        actualPayment: number(row.derived_paid_amount),
        acceptor: (row.approval_note ?? '') as string,
      }))
      currentReceipts.value = financeFacts.currentReceipts
      currentPayments.value = financeFacts.currentPayments
      targetCosts.value = costControl.versions
      targetCostCategories.value = costControl.categories
      expenditureContracts.value = expenditureRelations.contracts
      expenditureSupplements.value = expenditureRelations.supplements
      subcontractChanges.value = expenditureRelations.changes
      expenditureSettlements.value = expenditureRelations.settlements
      paymentRecords.value = financeFacts.paymentRecords
      deliveries.value = deliveryArchive
      acceptances.value = acceptanceLifecycle
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
    targetCosts: readonly(targetCosts),
    targetCostCategories: readonly(targetCostCategories),
    expenditureContracts: readonly(expenditureContracts),
    expenditureSupplements: readonly(expenditureSupplements),
    subcontractChanges: readonly(subcontractChanges),
    expenditureSettlements: readonly(expenditureSettlements),
    paymentRecords: readonly(paymentRecords),
    deliveries: readonly(deliveries),
    acceptances: readonly(acceptances),
    operationSummaries,
    invoiceOutputSummaries,
    invoiceSummaries,
    loading: readonly(loading),
    load,
  }
})
