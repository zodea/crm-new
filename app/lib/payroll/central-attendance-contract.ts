import type { DataOriginDTO } from '../../types/read-model'
import type { PayrollC1Context } from './central-c1-contract'
import type { PayrollCrewOption, PayrollParticipantOption, PayrollParticipantOptions, PayrollQuery, PayrollSourceDiagnostic, PayrollSourceEvidence } from './central-contract'

export interface PayrollWorkerFact {
  workerId: string
  crewId: string | null
  currentProjectId: string | null
  dailyWage: number | null
  dailyWageState: 'missing' | 'null' | 'value'
  sourceVersion: string
}
export interface PayrollAttendanceScope { projectId: string, month: string, crewId: string | null }
export interface PayrollAttendanceFact {
  id: string
  projectId: string
  crewId: string | null
  workerId: string
  workDate: string
  hours: number | null
  overtimeHours: number | null
  workContent: string | null
  note: string | null
  deletedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  sourceFingerprint: string
}
export type PayrollAttendanceDiagnostic = PayrollSourceDiagnostic
export interface PayrollAttendanceFacts {
  sourceVersion: string
  rows: PayrollAttendanceFact[]
  diagnostics: PayrollAttendanceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}
export interface PayrollSourceExclusion {
  projectId: string
  month: string
  workerId: string
  formatFamily: 'C1' | 'C2'
  kind: 'released-month' | 'daywork-occupation' | 'format-exclusion'
  statementId: string | null
  dayworkRecordId: string | null
  attendanceRecordId: string | null
  evidenceId: string | null
  legacyRecordId: string | null
}
export type PayrollAttendanceWorker = PayrollParticipantOption
export type PayrollC1CrewOption = PayrollCrewOption
export type PayrollC1Options = PayrollParticipantOptions
export interface PayrollAttendanceMatrixRead {
  context: PayrollC1Context
  scope: PayrollAttendanceScope
  options: Pick<PayrollC1Options, 'projects' | 'crews'>
  workers: PayrollAttendanceWorker[]
  records: PayrollAttendanceFact[]
  locks: PayrollSourceExclusion[]
  diagnostics: PayrollAttendanceDiagnostic[]
  evidence: PayrollSourceEvidence[]
}
export interface PayrollAttendanceRecordDraft {
  workerId: string
  crewId: string | null
  workDate: string
  hours: number
  overtimeHours: number
  workContent: string
  note: string
}
export interface PayrollAttendanceCommand {
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: 'payroll:write'
  sourceVersion: string
  projectId: string
  scope: PayrollAttendanceScope
  action: { kind: 'upsert-attendance', record: PayrollAttendanceRecordDraft }
}
export interface PayrollAttendanceCommandResult {
  commandId: string
  projectId: string
  recordId: string
  workerId: string
  workDate: string
  sourceVersion: string
  outcome: 'saved'
  logIds: string[]
}
export interface PayrollAttendancePending { command: PayrollAttendanceCommand, state: 'sending' | 'unknown' | 'awaiting-read' }
export interface PayrollAttendanceRepository {
  attendanceMatrix: (query: PayrollQuery, scope: PayrollAttendanceScope) => Promise<PayrollAttendanceMatrixRead>
  executeAttendance: (command: PayrollAttendanceCommand) => Promise<PayrollAttendanceCommandResult>
}
