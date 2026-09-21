import type { DataOriginDTO } from '../../types/read-model'
import type { PAYROLL_WRITE_CAPABILITY } from './central-a-contract'
import type { PayrollBatchFormat, PayrollBatchFundingSuggestion, PayrollBatchRounding } from './central-batch-contract'
import type { PayrollContext, PayrollJsonObject, PayrollQuery, PayrollWritableContext } from './central-contract'
import type { PayrollReleaseAdjustmentApplication } from './central-release-adjustment-contract'

export type PayrollBatchPurpose = 'check' | 'release'
export interface PayrollBatchTarget { itemId: string, statementId: string, formatFamily: PayrollBatchFormat }
export interface PayrollBatchAllocation { workerId: string, amountFen: number }
export type PayrollBatchDecision
  = | { kind: 'defer' }
    | { kind: 'check' }
    | { kind: 'release', actualAmountFen: number, allocations: PayrollBatchAllocation[], adjustmentApplications?: PayrollReleaseAdjustmentApplication[] }

export interface PayrollBatchPreviewInput {
  purpose: PayrollBatchPurpose
  projectId: string
  month: string
  statementIds: string[]
  fundingAmountFen: number | null
}

export interface PayrollBatchItemBasis {
  basisHash: string
  checkedSourceVersion: string
  evidence: PayrollJsonObject
}

export interface PayrollBatchPreviewItem {
  target: PayrollBatchTarget
  leaderWorkerId: string
  leaderName: string | null
  members: Array<{ workerId: string, workerName: string | null }>
  status: string
  needsRecheck: boolean
  eligibleAmountFen: number | null
  requiresFullAmount: boolean
  rounding: PayrollBatchRounding
  basis: PayrollBatchItemBasis
  reasons: string[]
}

export interface PayrollBatchPreviewRead {
  schemaVersion: 1
  context: PayrollWritableContext
  input: PayrollBatchPreviewInput
  previewVersion: string
  items: PayrollBatchPreviewItem[]
  funding: PayrollBatchFundingSuggestion | null
  reasons: string[]
}

export interface PayrollBatchConfirmInput {
  purpose: PayrollBatchPurpose
  projectId: string
  month: string
  previewVersion: string
  fundingAmountFen: number | null
  items: Array<PayrollBatchTarget & { decision: PayrollBatchDecision }>
}

export interface PayrollBatchConfirmCommand {
  schemaVersion: 1
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: typeof PAYROLL_WRITE_CAPABILITY
  action: { kind: 'confirm-batch', input: PayrollBatchConfirmInput }
}

interface PayrollBatchCommandBase {
  schemaVersion: 1
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: typeof PAYROLL_WRITE_CAPABILITY
}
export interface PayrollBatchPrepareCommand extends PayrollBatchCommandBase {
  action: { kind: 'prepare-batch-item', input: { planId: string, planVersion: string, executeCommandId: string } }
}
export interface PayrollBatchExecuteCommand extends PayrollBatchCommandBase {
  action: { kind: 'execute-batch-original', input: { planId: string, planVersion: string } }
}
export type PayrollBatchCommand = PayrollBatchConfirmCommand | PayrollBatchPrepareCommand | PayrollBatchExecuteCommand

export interface PayrollBatchPlanItem extends PayrollBatchPreviewItem { decision: PayrollBatchDecision }
export interface PayrollBatchItemOutcome {
  itemId: string
  state: 'succeeded' | 'not-executed' | 'unknown'
  attemptState: 'not-started' | 'prepared' | 'checked' | 'released' | 'needs-recheck' | 'not-applied' | 'unavailable'
  plannedAmountFen: number | null
  actualAmountFen: number | null
}
export interface PayrollBatchPlanRead {
  schemaVersion: 1
  context: PayrollContext
  commandId: string
  planId: string
  planVersion: string
  projectId: string
  month: string
  purpose: PayrollBatchPurpose
  fundingAmountFen: number | null
  state: 'ready' | 'prepared' | 'needs-recheck' | 'complete' | 'unavailable'
  preparedExecuteCommandId: string | null
  nextItemIndex: number
  expectedPayrollRevision: number
  items: PayrollBatchPlanItem[]
  outcomes: PayrollBatchItemOutcome[]
  reasons: string[]
}

export interface PayrollBatchRepository {
  batchPreview: (query: PayrollQuery, input: PayrollBatchPreviewInput) => Promise<PayrollBatchPreviewRead>
  executeBatch: (command: PayrollBatchCommand) => Promise<PayrollBatchPlanRead>
  batch: (query: PayrollQuery, planId: string) => Promise<PayrollBatchPlanRead>
}
