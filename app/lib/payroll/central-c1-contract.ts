import type { DataOriginDTO, NavigationIntentDTO } from '../../types/read-model'
import type { PayrollAttendanceFact, PayrollAttendanceWorker, PayrollC1Options } from './central-attendance-contract'
import type { PayrollContext, PayrollHistoryEntry, PayrollQuery } from './central-contract'

export interface PayrollC1Context extends Omit<PayrollContext, 'readonly'> { readonly: boolean }
export interface PayrollC1Draft {
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  memberWorkerIds: string[]
  month: string
  note: string
}
export type PayrollC1FormInput = ({ statementId: string, draftKey?: never } | { statementId: null, draftKey: string }) & { draft?: Partial<PayrollC1Draft> }
export interface PayrollC1ConfigScope { projectId: string, month: string, crewId: string | null }
export interface PayrollC1RateDraft { workerId: string, dailyWage: number | null, overtimeRate: number | null }
export interface PayrollC1Rate {
  workerId: string
  workerName: string | null
  profileDailyWage: number | null
  configuredDailyWage: number | null
  configuredOvertimeRate: number | null
  dailyWage: number | null
  dailyWageSource: 'worker-profile' | 'payroll-config' | 'missing'
  overtimeRate: number | null
  overtimeRateSource: 'payroll-config' | 'daily-divided-eight' | 'missing'
  configId: string | null
  revision: number | null
  effectiveMonth: string | null
  sourceVersion: string
}
export interface PayrollC1Line {
  id: string
  workerId: string
  workerName: string | null
  kind: 'normal' | 'overtime'
  itemName: string
  quantity: number
  unit: '小时'
  unitPrice: number | null
  amount: number | null
  attendanceIds: string[]
}
export interface PayrollC1Blocker {
  code: string
  message: string
  field: string | null
  workerId: string | null
  recordId: string | null
  statementId: string | null
  source: NavigationIntentDTO | null
}
export interface PayrollC1Amount { value: number | null, knownValue: number | null, state: 'known' | 'partial' | 'unknown', reasons: string[] }
export interface PayrollC1Eligibility { canSaveDraft: boolean, canCheck: boolean, canRelease: boolean, canOutput: boolean, reasons: string[] }
export interface PayrollC1FormRead {
  context: PayrollC1Context
  statementId: string | null
  draftKey: string | null
  status: 'new' | 'draft' | 'checked' | 'released'
  needsRecheck: boolean
  draft: Partial<PayrollC1Draft>
  options: PayrollC1Options
  members: PayrollAttendanceWorker[]
  facts: PayrollAttendanceFact[]
  sources: NavigationIntentDTO[]
  rates: PayrollC1Rate[]
  lines: PayrollC1Line[]
  totals: { grossAmount: PayrollC1Amount }
  blockers: PayrollC1Blocker[]
  eligibility: PayrollC1Eligibility
}
export interface PayrollC1ConfigRead {
  context: PayrollC1Context
  scope: PayrollC1ConfigScope
  options: PayrollC1Options
  rates: PayrollC1Rate[]
  readonlyReasons: string[]
  history: PayrollHistoryEntry[]
}
export interface PayrollC1ReleaseDraft { actualAmount: number | null, allocations: Array<{ workerId: string, amount: number | null }> }
export type PayrollC1Action = { kind: 'save-c1-draft', draft: PayrollC1Draft }
  | { kind: 'check-c1' }
  | { kind: 'release-c1', release: PayrollC1ReleaseDraft }
  | { kind: 'save-c1-rates', rates: PayrollC1RateDraft[] }
export interface PayrollC1Command {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: 'payroll:write'
  sourceVersion: string
  projectId: string
  statementId: string | null
  draftKey: string | null
  configScope: PayrollC1ConfigScope | null
  action: PayrollC1Action
}
export interface PayrollC1CommandResult {
  commandId: string
  projectId: string
  statementId: string | null
  rateRevisionIds: string[]
  sourceVersion: string
  outcome: 'saved' | 'checked' | 'released' | 'needs-recheck'
  logIds: string[]
}
export interface PayrollC1Pending { command: PayrollC1Command, state: 'sending' | 'unknown' | 'awaiting-read' }
export type PayrollC1CommandRead = PayrollC1FormRead | PayrollC1ConfigRead
export type PayrollC1StatementCommandResult = PayrollC1CommandResult & { statementId: string }
export interface PayrollC1StatementSourceSnapshot {
  schemaVersion: 1
  subject: Pick<PayrollC1Draft, 'projectId' | 'crewId' | 'leaderWorkerId' | 'memberWorkerIds'>
  month: string
  facts: PayrollAttendanceFact[]
  rates: PayrollC1Rate[]
}
export interface PayrollC1FrozenDocument {
  id: string
  projectId: string
  projectName: string
  crewId: string | null
  crewName: string | null
  leaderName: string
  month: string
  formatFamily: 'C1'
  periodKind: 'monthly'
  payRatio: 1
  grossAmount: number
  actualAmount: number
  releasedAt: string
  operatorName: string
  note: string
  lines: PayrollC1Line[]
  rates: PayrollC1Rate[]
  attendance: PayrollAttendanceFact[]
  members: Array<{ workerId: string, workerName: string, isLeader: boolean }>
  allocations: Array<{ workerId: string, workerName: string, isLeader: boolean, amount: number, allocatedAmountFen: number }>
}
export type PayrollC1OutputRead = { context: PayrollC1Context, statementId: string } & (
  { state: 'available', document: PayrollC1FrozenDocument, reasons: [] }
  | { state: 'unavailable', document: null, reasons: string[] }
)
export interface PayrollC1Repository {
  c1Form: (query: PayrollQuery, input: PayrollC1FormInput) => Promise<PayrollC1FormRead>
  c1Config: (query: PayrollQuery, scope: PayrollC1ConfigScope) => Promise<PayrollC1ConfigRead>
  c1Output: (query: PayrollQuery, statementId: string) => Promise<PayrollC1OutputRead>
  executeC1: (command: PayrollC1Command) => Promise<PayrollC1CommandResult>
}
