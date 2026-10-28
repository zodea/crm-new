import type { DataOriginDTO, EntityRefDTO, MoneyDTO, NavigationIntentDTO, PageDTO, ProblemDTO, ReadMetaDTO } from '../../types/read-model'
import type { ConstructionMainSelection } from '../construction-scope/contract'
import type { ContractFormAttachment, ContractFormAttachmentChanges, F2SaveAction } from '../contract/forms'
import type { OurSignatorySnapshot } from '../our-signatory/contract'

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
  ourSignatoryId?: string | null
  ourSignatoryVersion?: string | null
  ourSignatorySnapshot?: OurSignatorySnapshot | null
  signDate?: string
  servicePeriod?: string
  amount?: number | null
  taxRate?: number | null
  invoiceType?: string
  paymentCycle?: string
  mainTerms?: string
  content?: string
  contactName?: string
  contactPhone?: string
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
  constructionMain?: ConstructionMainSelection
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
  meta: ReadMetaDTO
  asOf: string
  sourceVersion: string | null
  contract: AuxiliaryContractDTO
  facts: AuxiliaryContractFact[]
  attachments: ContractFormAttachment[]
  capabilities: string[]
  constructionMain?: ConstructionMainSelection | null
  unavailableFactKinds?: AuxiliaryContractFact['kind'][]
  diagnostics?: string[]
}
export interface AuxiliaryImportCommand {
  commandId: string
  workspaceId: string
  actorId: string
  source: { sha256: string, payloadBase64: string }
  projects: Array<{ legacyId: string, id: string, version: string }>
  suppliers: Array<{ legacyId: string, id: string, version: string }>
  signatories: Array<{ legacyId: string, id: string, version: string }>
  originals: Array<{ fileId: string, payloadBase64: string }>
}
export interface AuxiliaryImportResult { commandId: string, importId: string, sourceSha256: string, ids: string[], supplementIds: string[], restored?: boolean }
export interface AuxiliaryImportPreview {
  sourceSha256: string
  schemaVersion: number
  contracts: Array<{ id: string, kind: AuxiliaryContractKind, name: string, no: string, deletedAt: string | null }>
  references: Array<{ kind: 'project' | 'supplier' | 'signatory', id: string, label: string, candidates: Array<{ id: string, label: string, version: string, deletedAt: string | null }> }>
  requiredOriginals: Array<{ id: string, name: string }>
}
export type AuxiliaryContractPage = PageDTO<AuxiliaryContractDTO, Record<DataOriginDTO, { count: number, amount: MoneyDTO | null }>> & { meta: ReadMetaDTO, originMeta: Record<DataOriginDTO, ReadMetaDTO>, projectOptions: Array<{ id: string, label: string }> }
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
