import type { DataOriginDTO, NavigationIntentDTO } from '../../types/read-model'
import type { PayrollSourceExclusion } from './central-attendance-contract'
import type { PayrollJsonObject, PayrollParticipantOptions, PayrollQuery, PayrollSourceDiagnostic, PayrollSourceEvidence, PayrollWritableContext } from './central-contract'

export type PayrollDayworkStatus = 'draft' | 'confirmed'
export interface PayrollDayworkScope {
  projectId: string
  month: string
  crewId: string | null
  dayworkStatuses: PayrollDayworkStatus[]
}
export interface PayrollDayworkFact {
  id: string
  projectId: string
  crewId: string | null
  workerId: string
  workDate: string
  workContent: string | null
  startTime: string | null
  endTime: string | null
  laborUnits: number | null
  witness: string | null
  confirmedOn: string | null
  status: string | null
  note: string | null
  createdAt: string | null
  updatedAt: string | null
  deletedAt: string | null
  sourceFingerprint: string
  original: PayrollJsonObject
}
export interface PayrollDayworkOccupation {
  dayworkRecordId: string
  linkId: string | null
  statementId: string
  projectId: string
  month: string
  formatFamily: string | null
  status: string | null
  statementDeletedAt: string | null
  linkDeletedAt: string | null
  kind: 'active-link' | 'released-link' | 'released-snapshot' | 'c2-source' | 'missing-head'
  evidenceId: string | null
  legacyRecordId: string | null
}
export interface PayrollDayworkFacts {
  sourceVersion: string
  rows: PayrollDayworkFact[]
  occupations: PayrollDayworkOccupation[]
  diagnostics: PayrollSourceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}
export interface PayrollDayworkRecordFacts {
  sourceVersion: string
  record: PayrollDayworkFact | null
  occupations: PayrollDayworkOccupation[]
  diagnostics: PayrollSourceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}
export interface PayrollDayworkOccupationQuery { projectId?: string, recordIds?: string[] }

export interface PayrollDayworkRecordDraft {
  projectId: string
  crewId: string | null
  workerId: string
  workDate: string
  workContent: string
  startTime: string
  endTime: string
  laborUnits: number | null
  witness: string
  confirmedOn: string | null
  status: PayrollDayworkStatus
  note: string
}
export interface PayrollDayworkEligibility { canEdit: boolean, canConfirm: boolean, reasons: string[] }
export interface PayrollDayworkRecordRead extends PayrollDayworkFact {
  workerName: string | null
  crewName: string | null
  source: NavigationIntentDTO | null
  occupations: PayrollDayworkOccupation[]
  locks: PayrollSourceExclusion[]
  diagnostics: PayrollSourceDiagnostic[]
  eligibility: PayrollDayworkEligibility
  availability: 'available' | 'pending' | 'occupied' | 'invalid' | 'deleted'
}
export interface PayrollDayworkListRead {
  context: PayrollWritableContext
  scope: PayrollDayworkScope
  options: PayrollParticipantOptions
  records: PayrollDayworkRecordRead[]
  locks: PayrollSourceExclusion[]
  diagnostics: PayrollSourceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}
export type PayrollDayworkFormInput = (
  { recordId: string, draftKey?: never } | { recordId: null, draftKey: string }
) & { draft?: Partial<PayrollDayworkRecordDraft> }
export interface PayrollDayworkFormRead {
  context: PayrollWritableContext
  recordId: string | null
  draftKey: string | null
  record: PayrollDayworkRecordRead | null
  draft: Partial<PayrollDayworkRecordDraft>
  options: PayrollParticipantOptions
  eligibility: PayrollDayworkEligibility
  diagnostics: PayrollSourceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}

export interface PayrollDayworkOriginalScope {
  projectId: string
  crewId: string | null
  workerId: string
  workDate: string
}
export type PayrollDayworkAction
  = | { kind: 'save-daywork', record: PayrollDayworkRecordDraft }
    | { kind: 'confirm-daywork', confirmation: { witness: string, confirmedOn: string } }
export interface PayrollDayworkCommand {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: 'payroll:write'
  sourceVersion: string
  projectId: string
  recordId: string | null
  draftKey: string | null
  originalScope: PayrollDayworkOriginalScope | null
  action: PayrollDayworkAction
}
export interface PayrollDayworkCommandResult {
  commandId: string
  projectId: string
  recordId: string
  recordProjectId: string
  workerId: string
  workDate: string
  status: PayrollDayworkStatus
  affectedStatementIds: string[]
  recordFingerprint: string
  sourceVersion: string
  outcome: 'saved' | 'confirmed'
  logIds: string[]
}
export interface PayrollDayworkPending {
  command: PayrollDayworkCommand
  state: 'sending' | 'unknown' | 'awaiting-read'
}
export interface PayrollDayworkRepository {
  dayworkList: (query: PayrollQuery, scope: PayrollDayworkScope) => Promise<PayrollDayworkListRead>
  dayworkForm: (query: PayrollQuery, input: PayrollDayworkFormInput) => Promise<PayrollDayworkFormRead>
  executeDaywork: (command: PayrollDayworkCommand) => Promise<PayrollDayworkCommandResult>
}
