import type { CompletenessDTO, DataOriginDTO, MoneyDTO, NavigationIntentDTO } from '../../types/read-model'
import type { MasterDataSaveAction, TargetCostFormDraft } from '../master-data/forms'
import type { CostCategory } from '../project/cost-control'
import type { BudgetFileChanges, BudgetFileContentDTO, BudgetFileDTO } from './central-files'
import type { TargetCostDetailHeader, TargetCostDetailItem } from './detail'
import type { TargetCostItemDraft } from './items'
import type { TargetCostListRow } from './list'
import { projectProblem, ProjectRepositoryProblem } from '../project/repository'

export const TARGET_COST_READ_CAPABILITY = 'target-cost:read' as const
export const TARGET_COST_WRITE_CAPABILITY = 'target-cost:write' as const
export interface TargetCostQuery { origin: DataOriginDTO, includeDemo?: boolean }
export interface TargetCostContext {
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  capabilities: readonly string[]
  sourceVersion: string
}
export interface TargetCostProjectOption { id: string, code: string, name: string }
export interface TargetCostMetric {
  value: number | null
  knownValue: number | null
  status: CompletenessDTO
  missingSources: string[]
}
export interface TargetCostCategory {
  id: string
  category: CostCategory
  targetAmount: number
  targetLineCount: number
  signedAmount: TargetCostMetric
  settledAmount: TargetCostMetric
  paidAmount: TargetCostMetric
  remainingAmount: TargetCostMetric
  sources: Record<'contract' | 'settlement' | 'payment' | 'reimbursement', NavigationIntentDTO | null>
}
export interface TargetCostSummary {
  itemTotal: number
  signedAmount: TargetCostMetric
  settledAmount: TargetCostMetric
  paidAmount: TargetCostMetric
  remainingAmount: TargetCostMetric
}
export interface TargetCostHistoryEntry { id: string, tableName: string, recordId: string, operation: string, operatedAt: string | null, operator: string | null, beforeData: unknown, afterData: unknown }
export interface TargetCostFormRead {
  context: TargetCostContext
  targetCostId: string | null
  draftKey: string | null
  draft: TargetCostFormDraft
  deletedAt: string | null
  files: BudgetFileDTO[]
  projects: TargetCostProjectOption[]
  projectOptionsStatus: 'available' | 'forbidden' | 'unavailable'
}
export interface TargetCostListRead { context: TargetCostContext, rows: TargetCostListRow[] }
export interface TargetCostDetailRead {
  context: TargetCostContext
  targetCostId: string
  deletedAt: string | null
  view: {
    header: TargetCostDetailHeader
    items: TargetCostDetailItem[]
    categories: TargetCostCategory[]
    summary: TargetCostSummary
  }
  files: BudgetFileDTO[]
  history: TargetCostHistoryEntry[]
  actualSourceVersion: string
}
export type TargetCostAction = {
  kind: 'save-header'
  draft: TargetCostFormDraft
  saveAction: MasterDataSaveAction
  files?: BudgetFileChanges
} | { kind: 'save-items', items: TargetCostItemDraft[] }
| { kind: 'delete' | 'restore' }
export interface TargetCostCommand {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: typeof TARGET_COST_WRITE_CAPABILITY
  sourceVersion: string
  targetCostId: string | null
  draftKey?: string
  action: TargetCostAction
}
export interface TargetCostCommandResult {
  commandId: string
  id: string
  sourceVersion: string
  logIds: string[]
  attachmentIds: string[]
  affectedVersionIds: string[]
}
export interface TargetCostFileRead { context: TargetCostContext, content: BudgetFileContentDTO }
export interface TargetCostPending { command: TargetCostCommand, state: 'sending' | 'unknown' }
export interface TargetCostRepository {
  list: (query: TargetCostQuery) => Promise<TargetCostListRead>
  form: (query: TargetCostQuery, id: string | null, draftKey?: string) => Promise<TargetCostFormRead>
  detail: (query: TargetCostQuery, id: string) => Promise<TargetCostDetailRead>
  file: (query: TargetCostQuery, id: string, fileId: string) => Promise<TargetCostFileRead>
  execute: (command: TargetCostCommand) => Promise<TargetCostCommandResult>
}

/** Wire 金额使用 MoneyDTO；Repository 在已验证边界转换为页面 number|null。 */
export const TARGET_COST_MONEY_FIELDS = ['contractRevenue', 'plannedProfit', 'signedContractSum', 'taxInclusiveTotal', 'taxExclusiveTotal', 'taxAmount'] as const
type HeaderMoneyKey = typeof TARGET_COST_MONEY_FIELDS[number]
type MoneyRecord<T> = Omit<T, HeaderMoneyKey> & { [K in Extract<HeaderMoneyKey, keyof T>]: MoneyDTO | null }
export type TargetCostListDTO = Omit<TargetCostListRead, 'rows'> & { rows: MoneyRecord<TargetCostListRow>[] }
export type TargetCostFormDTO = Omit<TargetCostFormRead, 'draft'> & { draft: MoneyRecord<TargetCostFormDraft> }
export function targetCostProblem(code: Parameters<typeof projectProblem>[0], message: string, fieldErrors?: Record<string, string[]>) {
  return new ProjectRepositoryProblem({ ...projectProblem(code, message), ...(fieldErrors ? { fieldErrors } : {}) })
}
