import type { EntityRefDTO, MoneyDTO, NavigationIntentDTO, PageDTO } from '../../types/read-model'
import type { AuxiliaryContractAudit } from '../auxiliary-contract/contract'
import type { ContractFormAttachment, ContractFormAttachmentChanges } from '../contract/forms'
import type { ExpenseClearanceAllocationDTO, ExpenseClearanceAllocationInput, ExpenseClearanceLink, ExpenseClearanceLinkEdit } from '../finance/clearance-verification'

export const OTHER_SETTLEMENT_PATH = '/contract/other-settlement'
export const OTHER_SETTLEMENT_STATUS_LABELS: Record<string, string> = { draft: '草稿', pending: '待确认', confirmed: '已确认', 已确认: '已确认' }
export interface OtherSettlementExpenseInput {
  originalExpenseLineId: string
  sourceVersion: string
  sourceRevision: string
  amount: number | null
  clearanceAllocations?: ExpenseClearanceAllocationInput[]
}
export interface OtherSettlementDraft {
  clearanceLinkEdit?: ExpenseClearanceLinkEdit
  id?: string
  no?: string
  name?: string
  projectId?: string | null
  contractId?: string | null
  supplierId?: string | null
  totalAmount?: number | null
  taxRate?: number | null
  settlementDate?: string
  settlementType?: string
  period?: string
  deductionNote?: string
  note?: string
  status?: string
  payeeSupplierId?: string | null
  payeeWorkerId?: string | null
  payeeNameSnapshot?: string | null
  originalExpenses?: OtherSettlementExpenseInput[]
}
export interface OtherSettlementStored {
  id: string
  version: number
  workspaceId: string
  migrationBatchId: string | null
  draft: OtherSettlementDraft
  attachments: ContractFormAttachment[]
  audit: AuxiliaryContractAudit
  facts: OtherSettlementFact[] | null
}
export interface OtherSettlementResult {
  id: string
  version: string
  commandId: string
  updatedAt: string
  attachmentIds: string[]
  clearanceLinkIds?: string[]
}
export interface OtherSettlementCommand {
  id?: string
  workspaceId: string
  actorId: string
  requiredCapability: string
  commandId: string
  baseVersion: string | null
  action: 'draft' | 'save' | 'submit' | 'confirm'
  draft: OtherSettlementDraft
  attachments: ContractFormAttachmentChanges
}
export interface OtherSettlementContract {
  id: string
  kind: string
  name: string
  projectId: string | null
  supplierId: string | null
  status: string
  amount: MoneyDTO | null
  changedAmount: MoneyDTO | null
}
export interface OtherSettlementContext {
  workspaceId: string
  actorId: string
  capabilities: readonly string[]
  projects: Array<{
    id: string
    label: string
  }>
  suppliers: Array<{
    id: string
    label: string
  }>
  contracts: OtherSettlementContract[]
  workers?: Array<{
    id: string
    label: string
  }>
}
export interface OtherSettlementFact {
  id: string
  allocationId?: string
  kind: 'penalty' | 'application' | 'payment'
  settlementId: string
  projectId: string | null
  contractId: string | null
  supplierId: string | null
  sourceId: string
  parentId: string | null
  no: string
  name: string
  amount: MoneyDTO | null
  date: string | null
  status: string
  effective: boolean
  attribution: 'exact' | 'unknown'
  unavailableReason?: string
}
export interface OtherSettlementSourceDocument {
  id: string
  kind: OtherSettlementFact['kind']
  no: string
  name: string
  status: string
  amount: MoneyDTO | null
  date: string | null
  projectId: string | null
  contractId: string | null
  supplierId: string | null
  fields: Array<{
    label: string
    value: string | null
  }>
  allocations: Array<{
    id: string
    targetId: string | null
    kind: 'settlement' | 'application'
    amount: MoneyDTO | null
    effective: boolean
    unavailableReason: string | null
  }>
  files: Array<{
    id: string
    fileName: string
    fileSize: number
    uploader: string
    uploadedAt: string
  }>
}
export const OTHER_SETTLEMENT_AMOUNT_LABELS = {
  total: '含税结算金额',
  deductions: '奖罚扣款合计',
  net: '本次结算金额',
  applied: '累计已申请付款金额',
  applicable: '剩余可付款金额',
  paid: '累计已付款金额',
  unpaid: '剩余未付款金额',
  contract: '原合同金额',
  changedContract: '变更后合同金额',
  prior: '前期累计结算金额',
  cumulative: '累计结算金额',
  taxExclusive: '本次无税结算金额',
  tax: '税额',
} as const
export type OtherSettlementAmounts = Record<keyof typeof OTHER_SETTLEMENT_AMOUNT_LABELS, MoneyDTO | null>
export interface OtherSettlementDTO {
  expenseAllocations?: ExpenseClearanceAllocationDTO[]
  clearanceLinks?: ExpenseClearanceLink[]
  id: string
  version: string
  dataOrigin: 'real'
  draft: OtherSettlementDraft
  project: EntityRefDTO
  supplier: EntityRefDTO
  contract: EntityRefDTO
  navigation: NavigationIntentDTO
  amounts: OtherSettlementAmounts
  qualificationUnavailableReason?: string
  audit: AuxiliaryContractAudit
  attachmentCount: number
}
export interface OtherSettlementDetail {
  settlement: OtherSettlementDTO
  facts: OtherSettlementFact[] | null
  attachments: ContractFormAttachment[]
  capabilities: readonly string[]
  history?: Array<{
    version: string
    record: OtherSettlementStored
    actorId: string | null
    commandId: string
    occurredAt: string
  }>
  sourceHistory?: Array<{ sourceBytesSha256: string, rawHead: Record<string, unknown>, history: unknown[], commands: unknown[], audit: unknown[], retained?: Record<string, unknown[]> }>
}
export type OtherSettlementPage = PageDTO<OtherSettlementDTO, {
  count: number
  amount: MoneyDTO | null
}> & {
  projectOptions: OtherSettlementContext['projects']
}
