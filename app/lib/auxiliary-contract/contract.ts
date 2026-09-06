import type { DataOriginDTO, EntityRefDTO, MoneyDTO, NavigationIntentDTO, PageDTO, ProblemDTO } from '../../types/read-model'
import type { ContractFormAttachment, ContractFormAttachmentChanges, F2SaveAction } from '../contract/forms'

export type AuxiliaryContractKind = 'other_expense' | 'company_expense'
export const AUXILIARY_LABELS = { other_expense: '其他支出合同', company_expense: '公司支出合同' } as const
export const AUXILIARY_CATEGORIES: Record<AuxiliaryContractKind, readonly string[]> = { other_expense: ['机械租赁', '检测服务', '其他'], company_expense: ['房租', '软件', '其他'] }
export interface AuxiliaryContractDraft {
  id?: string
  kind: AuxiliaryContractKind
  no?: string
  name?: string
  projectId?: string | null
  supplierId?: string | null
  category?: string
  counterparty?: string
  partyA?: string
  signDate?: string
  servicePeriod?: string
  amount?: number | null
  taxRate?: number | null
  invoiceType?: string
  paymentCycle?: string
  mainTerms?: string
  status?: string
  note?: string
}
export interface AuxiliaryContractCommand {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: string
  commandId: string
  baseVersion: string | null
  action: F2SaveAction
  draft: AuxiliaryContractDraft
  attachments: ContractFormAttachmentChanges
}
export interface AuxiliaryContractAudit {
  createdBy: string | null
  updatedBy: string | null
  createdAt: string | null
  updatedAt: string | null
  responsible: string | null
  department: string | null
}
export interface AuxiliaryContractFact {
  id: string
  contractId: string
  contractKind: AuxiliaryContractKind
  dataOrigin: DataOriginDTO
  kind: 'invoice' | 'payment' | 'settlement' | 'supplement'
  no: string
  name: string
  amount: MoneyDTO | null
  date: string | null
  status: string
  effective: boolean
}
export interface AuxiliaryContractDTO {
  id: string
  dataOrigin: DataOriginDTO
  kind: AuxiliaryContractKind
  draft: AuxiliaryContractDraft
  project: EntityRefDTO | null
  supplier: EntityRefDTO | null
  navigation: NavigationIntentDTO
  amounts: {
    contract: MoneyDTO | null
    changed: MoneyDTO | null
    taxExclusive: MoneyDTO | null
    tax: MoneyDTO | null
    invoiced: MoneyDTO | null
    paid: MoneyDTO | null
    settled: MoneyDTO | null
    byInvoicePayable: MoneyDTO | null
    bySettlementPayable: MoneyDTO | null
  }
  settlementStatus: string | null
  clearanceStatus: string | null
  audit: AuxiliaryContractAudit
  attachmentCount: number
  attachmentCategories: Record<string, number>
  version: string
}
export interface AuxiliaryContractDetail {
  contract: AuxiliaryContractDTO
  facts: AuxiliaryContractFact[]
  attachments: ContractFormAttachment[]
  capabilities: string[]
}
export type AuxiliaryContractPage = PageDTO<AuxiliaryContractDTO, Record<DataOriginDTO, { count: number, amount: MoneyDTO | null }>> & { projectOptions: Array<{ id: string, label: string }> }
export class AuxiliaryContractProblem extends Error {
  constructor(public readonly problem: ProblemDTO) { super(problem.message) }
}
export function auxiliaryProblem(code: ProblemDTO['code'], message: string, fieldErrors: Record<string, string[]> = {}): AuxiliaryContractProblem {
  return new AuxiliaryContractProblem({ code, message, fieldErrors, retryable: code === 'unavailable', traceId: null })
}
export function auxiliaryKind(value: unknown): AuxiliaryContractKind {
  if (value !== 'other_expense' && value !== 'company_expense')
    throw auxiliaryProblem('invalid-query', '合同类型不匹配')
  return value
}
export function auxiliaryListPath(kind: AuxiliaryContractKind) {
  return `/contract/${kind === 'other_expense' ? 'other-expense' : 'company-expense'}`
}
export function auxiliaryDetailPath(kind: AuxiliaryContractKind, id: string, origin: DataOriginDTO = 'real') {
  return `${auxiliaryListPath(kind)}/${encodeURIComponent(id)}?origin=${origin}`
}
