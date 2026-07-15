interface ProjectAmountRow {
  projectId: string
  amount: number
}

interface ProjectTaxRow extends ProjectAmountRow {
  taxAmount: number
}

interface ProjectPaymentRow {
  projectId: string
  actualPayment: number
}

interface ProjectChangeRow {
  projectId: string
  taxIncAmount: number
}

interface ProjectInvoiceRow extends ProjectTaxRow {
  accountStatus: string
}

export interface ProjectOperationSource {
  projectId: string
  constructionContracts?: readonly ProjectAmountRow[]
  supplementAgreements?: readonly ProjectAmountRow[]
  ownerChangeOrders?: readonly ProjectChangeRow[]
  receiptRegistrations?: readonly ProjectAmountRow[]
  paymentApplications?: readonly ProjectPaymentRow[]
  currentReceipts?: readonly ProjectAmountRow[]
  currentPayments?: readonly ProjectAmountRow[]
  /** 管理费配置表尚未建设，当前由调用方显式传入 seed 值。 */
  managementFee?: number
}

export interface ProjectOperationSummary {
  mainContractAmount: number
  supplementAmount: number
  ownerChangeAmount: number
  changedContractAmount: number
  projectReceipt: number
  paymentAmount: number
  currentReceipt: number
  currentPayment: number
  managementFee: number
  availableBalance: number
}

export interface ProjectInvoiceSource {
  projectId: string
  invoiceApplications?: readonly ProjectTaxRow[]
  invoices?: readonly ProjectInvoiceRow[]
}

export interface ProjectInvoiceSummary {
  outputAmount: number
  outputTax: number
  inputAmount: number
  inputTax: number
  vat: number
  /** 小数口径：0.05 = 5%。 */
  taxBurdenRate: number
  archivedCount: number
}

function money(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function sumProject<T extends { projectId: string }>(
  rows: readonly T[] | undefined,
  projectId: string,
  value: (row: T) => unknown,
): number {
  return (rows ?? []).reduce(
    (total, row) => row.projectId === projectId ? total + money(value(row)) : total,
    0,
  )
}

export function calculateProjectOperationSummary(
  source: ProjectOperationSource,
): ProjectOperationSummary {
  const mainContractAmount = sumProject(source.constructionContracts, source.projectId, row => row.amount)
  const supplementAmount = sumProject(source.supplementAgreements, source.projectId, row => row.amount)
  const ownerChangeAmount = sumProject(source.ownerChangeOrders, source.projectId, row => row.taxIncAmount)
  const projectReceipt = sumProject(source.receiptRegistrations, source.projectId, row => row.amount)
  const paymentAmount = sumProject(source.paymentApplications, source.projectId, row => row.actualPayment)
  const currentReceipt = sumProject(source.currentReceipts, source.projectId, row => row.amount)
  const currentPayment = sumProject(source.currentPayments, source.projectId, row => row.amount)
  const managementFee = money(source.managementFee)

  return {
    mainContractAmount,
    supplementAmount,
    ownerChangeAmount,
    changedContractAmount: mainContractAmount + supplementAmount + ownerChangeAmount,
    projectReceipt,
    paymentAmount,
    currentReceipt,
    currentPayment,
    managementFee,
    availableBalance: projectReceipt + currentReceipt - paymentAmount - currentPayment - managementFee,
  }
}

export function calculateProjectInvoiceSummary(
  source: ProjectInvoiceSource,
): ProjectInvoiceSummary {
  const outputAmount = sumProject(source.invoiceApplications, source.projectId, row => row.amount)
  const outputTax = sumProject(source.invoiceApplications, source.projectId, row => row.taxAmount)
  const archivedInvoices = (source.invoices ?? []).filter(invoice =>
    invoice.projectId === source.projectId && invoice.accountStatus === 'archived',
  )
  const inputAmount = archivedInvoices.reduce((total, invoice) => total + money(invoice.amount), 0)
  const inputTax = archivedInvoices.reduce((total, invoice) => total + money(invoice.taxAmount), 0)
  const vat = outputTax - inputTax

  return {
    outputAmount,
    outputTax,
    inputAmount,
    inputTax,
    vat,
    taxBurdenRate: outputAmount === 0 ? 0 : vat / outputAmount,
    archivedCount: archivedInvoices.length,
  }
}
