import type { EntityRefDTO, MoneyDTO, NavigationIntentDTO, PageDTO } from '../../types/read-model'
import type { AuxiliaryContractAudit } from '../auxiliary-contract/contract'
import type { ContractFormAttachment, ContractFormAttachmentChanges } from '../contract/forms'

export const OTHER_SETTLEMENT_PATH = '/contract/other-settlement'
export interface OtherSettlementDraft {
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
}
export interface OtherSettlementFact {
  id: string
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
  id: string
  version: string
  dataOrigin: 'real'
  draft: OtherSettlementDraft
  project: EntityRefDTO
  supplier: EntityRefDTO
  contract: EntityRefDTO
  navigation: NavigationIntentDTO
  amounts: OtherSettlementAmounts
  audit: AuxiliaryContractAudit
  attachmentCount: number
}
export interface OtherSettlementDetail {
  settlement: OtherSettlementDTO
  facts: OtherSettlementFact[] | null
  attachments: ContractFormAttachment[]
  capabilities: readonly string[]
}
export type OtherSettlementPage = PageDTO<OtherSettlementDTO, {
  count: number
  amount: MoneyDTO | null
}> & {
  projectOptions: OtherSettlementContext['projects']
}
