import type { DataOriginDTO, NavigationIntentDTO } from '../../types/read-model'
import type { PayrollHistoryEntry, PayrollJsonObject, PayrollParticipantOption, PayrollParticipantOptions, PayrollQuery, PayrollSourceDiagnostic, PayrollSourceEvidence, PayrollWritableContext } from './central-contract'
import type { PayrollDayworkFact, PayrollDayworkRecordRead } from './central-daywork-contract'

export interface PayrollC2ConfigScope { projectId: string, leaderWorkerId: string }
export interface PayrollC2ConfigFact {
  id: string
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  formatFamily: string | null
  unitRate: number | null
  ruleText: string | null
  enabled: boolean | null
  createdAt: string | null
  updatedAt: string | null
  deletedAt: string | null
  sourceFingerprint: string
  original: PayrollJsonObject
}
export interface PayrollC2ConfigFacts {
  sourceVersion: string
  rows: PayrollC2ConfigFact[]
  diagnostics: PayrollSourceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}
export interface PayrollC2ConfigDraft { crewId: string | null, unitRate: number | null, ruleText: string | null }
export interface PayrollC2ConfigRead {
  context: PayrollWritableContext
  scope: PayrollC2ConfigScope
  options: PayrollParticipantOptions
  config: PayrollC2ConfigFact | null
  configs: PayrollC2ConfigFact[]
  draft: PayrollC2ConfigDraft
  diagnostics: PayrollSourceDiagnostic[]
  evidence: PayrollSourceEvidence[]
  readonlyReasons: string[]
  history: PayrollHistoryEntry[]
}

export interface PayrollC2Draft {
  projectId: string
  crewId: string | null
  leaderWorkerId: string
  memberWorkerIds: string[]
  month: string
  note: string
}
export type PayrollC2FormInput = (
  { statementId: string, draftKey?: never } | { statementId: null, draftKey: string }
) & { draft?: Partial<PayrollC2Draft> }
export interface PayrollC2Line {
  id: string
  workerId: string
  workerName: string | null
  kind: 'daywork'
  itemName: string
  quantity: number
  unit: '工'
  unitPrice: number | null
  amount: number | null
  dayworkIds: string[]
}
export interface PayrollC2Blocker {
  code: string
  message: string
  field: string | null
  workerId: string | null
  recordId: string | null
  statementId: string | null
  source: NavigationIntentDTO | null
}
export interface PayrollC2Amount {
  value: number | null
  knownValue: number | null
  state: 'known' | 'partial' | 'unknown'
  reasons: string[]
}
export interface PayrollC2Eligibility {
  canSaveDraft: boolean
  canCheck: boolean
  canRelease: boolean
  canOutput: boolean
  reasons: string[]
}
export interface PayrollC2MemberSnapshot { workerId: string, workerName: string, crewId: string | null }
export interface PayrollC2StatementSourceSnapshot {
  schemaVersion: 1
  subject: Pick<PayrollC2Draft, 'projectId' | 'crewId' | 'leaderWorkerId' | 'memberWorkerIds'>
  month: string
  facts: PayrollDayworkFact[]
  config: PayrollC2ConfigFact
  members: PayrollC2MemberSnapshot[]
  qualificationVersion: string
}
export interface PayrollC2FormRead {
  context: PayrollWritableContext
  statementId: string | null
  draftKey: string | null
  status: 'new' | 'draft' | 'checked' | 'released'
  needsRecheck: boolean
  draft: Partial<PayrollC2Draft>
  options: PayrollParticipantOptions
  members: PayrollParticipantOption[]
  facts: PayrollDayworkRecordRead[]
  adoptedRecordIds: string[]
  qualificationVersion: string
  config: PayrollC2ConfigFact | null
  storedSource: PayrollC2StatementSourceSnapshot | null
  sources: NavigationIntentDTO[]
  lines: PayrollC2Line[]
  totals: { grossAmount: PayrollC2Amount }
  blockers: PayrollC2Blocker[]
  eligibility: PayrollC2Eligibility
  diagnostics: PayrollSourceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}
export interface PayrollC2ReleaseDraft {
  actualAmount: number | null
  allocations: Array<{ workerId: string, amount: number | null }>
}
export interface PayrollC2FrozenDocument {
  id: string
  projectId: string
  projectName: string
  crewId: string | null
  crewName: string | null
  leaderName: string
  month: string
  formatFamily: 'C2'
  periodKind: 'monthly'
  payRatio: 1
  grossAmount: number
  actualAmount: number
  releasedAt: string
  operatorName: string
  note: string
  lines: PayrollC2Line[]
  daywork: PayrollDayworkFact[]
  config: PayrollC2ConfigFact
  members: Array<{ workerId: string, workerName: string, isLeader: boolean }>
  allocations: Array<{ workerId: string, workerName: string, isLeader: boolean, amount: number, allocatedAmountFen: number }>
}
export type PayrollC2OutputRead = { context: PayrollWritableContext, statementId: string } & (
  { state: 'available', document: PayrollC2FrozenDocument, reasons: [] }
  | { state: 'unavailable', document: null, reasons: string[] }
)

export type PayrollC2Action
  = | { kind: 'save-c2-draft', draft: PayrollC2Draft }
    | { kind: 'check-c2' }
    | { kind: 'release-c2', release: PayrollC2ReleaseDraft }
    | { kind: 'save-c2-config', config: PayrollC2ConfigDraft }
export interface PayrollC2Command {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: 'payroll:write'
  sourceVersion: string
  projectId: string
  statementId: string | null
  draftKey: string | null
  configScope: PayrollC2ConfigScope | null
  configId: string | null
  action: PayrollC2Action
}
export interface PayrollC2CommandResult {
  commandId: string
  projectId: string
  statementId: string | null
  configId: string
  dayworkRecordIds: string[]
  dayworkLinkIds: string[]
  sourceVersion: string
  outcome: 'saved' | 'checked' | 'released' | 'needs-recheck'
  logIds: string[]
}
export interface PayrollC2Pending { command: PayrollC2Command, state: 'sending' | 'unknown' | 'awaiting-read' }
export type PayrollC2CommandRead = PayrollC2FormRead | PayrollC2ConfigRead
export type PayrollC2StatementCommandResult = PayrollC2CommandResult & { statementId: string }
export interface PayrollC2Repository {
  c2Form: (query: PayrollQuery, input: PayrollC2FormInput) => Promise<PayrollC2FormRead>
  c2Config: (query: PayrollQuery, scope: PayrollC2ConfigScope) => Promise<PayrollC2ConfigRead>
  c2Output: (query: PayrollQuery, statementId: string) => Promise<PayrollC2OutputRead>
  executeC2: (command: PayrollC2Command) => Promise<PayrollC2CommandResult>
}
