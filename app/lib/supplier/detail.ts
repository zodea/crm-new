import { round2 } from '~/lib/util/number'

export {
  canonicalCredentialCategory,
  credentialExpiryState,
  defaultCredentialRequirement,
  REQUIRED_SUPPLIER_CREDENTIALS,
  resolveAutomaticCredentialStatus,
  resolveCredentialStatus,
  shanghaiBusinessDate,
  SUPPLIER_CREDENTIAL_CATEGORIES,
} from '~/lib/supplier/credentials'
export type {
  AutomaticCredentialStatus,
  SupplierCredentialCategory,
  SupplierCredentialExpiryState,
  SupplierCredentialRequirement,
  SupplierCredentialRequirementFact,
} from '~/lib/supplier/credentials'

export interface SupplierProjectRelation {
  id: string
  projectId: string
  projectName: string
  projectStatus: string
  relationshipStatus: string
}

export interface SupplierContractSummary {
  id: string
  no: string
  name: string
  kind: string
  projectId: string
  projectName: string
  amount: number
  changed: number
  settled: number
  paid: number
  signDate: string
  status: string
}

export interface SupplierPaymentSummary {
  id: string
  applicationNo: string
  name: string
  projectId: string
  projectName: string
  amount: number
  approvedAmount: number
  paidAmount: number
  actualPayment: number
  approvalStatus: string
  paymentStatus: string
  createdAt: string
}

export interface SupplierInvoiceSummary {
  id: string
  invoiceNumber: string
  invoiceType: string
  invoiceDate: string
  projectId: string | null
  projectName: string
  totalAmount: number
  taxAmount: number
}

export interface SupplierProjectSummary {
  projectId: string
  projectName: string
  projectStatus: string
  relationshipStatus: string
  contractCount: number
  contractTotal: number
  paidTotal: number
  payableBalance: number
  settlementStatus: string
}

export interface SupplierReadonlySummary {
  projectCount: number
  contractCount: number
  contractTotal: number
  claimedTotal: number
  invoiceTotal: number
  invoiceTaxTotal: number
  paidTotal: number
  payableBalance: number
}

export function buildSupplierProjectSummaries(
  relations: readonly SupplierProjectRelation[],
  contracts: readonly SupplierContractSummary[],
  payments: readonly SupplierPaymentSummary[] = [],
): SupplierProjectSummary[] {
  const projects = new Map<string, SupplierProjectSummary>()

  for (const relation of relations) {
    projects.set(relation.projectId, {
      projectId: relation.projectId,
      projectName: relation.projectName,
      projectStatus: relation.projectStatus,
      relationshipStatus: relation.relationshipStatus,
      contractCount: 0,
      contractTotal: 0,
      paidTotal: 0,
      payableBalance: 0,
      settlementStatus: '资料收集',
    })
  }

  for (const contract of contracts) {
    const project = projects.get(contract.projectId)
    if (!project)
      continue
    project.contractCount++
    project.contractTotal = round2(project.contractTotal + contract.amount)
  }

  for (const payment of payments) {
    const project = projects.get(payment.projectId)
    if (!project)
      continue
    project.paidTotal = round2(project.paidTotal + payment.actualPayment)
  }

  return [...projects.values()]
    .map(project => ({
      ...project,
      payableBalance: round2(project.contractTotal - project.paidTotal),
      settlementStatus: project.contractCount === 0
        ? '资料收集'
        : project.contractTotal - project.paidTotal <= 0
          ? '已结清'
          : '履约中',
    }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName, 'zh-CN'))
}

export function buildSupplierReadonlySummary(
  projects: readonly SupplierProjectSummary[],
  contracts: readonly SupplierContractSummary[],
  payments: readonly SupplierPaymentSummary[],
  invoices: readonly SupplierInvoiceSummary[],
): SupplierReadonlySummary {
  const contractTotal = round2(contracts.reduce((sum, row) => sum + row.amount, 0))
  const paidTotal = round2(payments.reduce((sum, row) => sum + row.actualPayment, 0))
  return {
    projectCount: projects.length,
    contractCount: contracts.length,
    contractTotal,
    claimedTotal: round2(payments.reduce((sum, row) => sum + row.approvedAmount, 0)),
    invoiceTotal: round2(invoices.reduce((sum, row) => sum + row.totalAmount, 0)),
    invoiceTaxTotal: round2(invoices.reduce((sum, row) => sum + row.taxAmount, 0)),
    paidTotal,
    payableBalance: round2(contractTotal - paidTotal),
  }
}
