import type { DataOriginDTO, NavigationIntentDTO } from '../../types/read-model'
import type { PayrollARepository } from './central-a-contract'
import type { PayrollABookRef, PayrollAFeesRepository } from './central-a-fees-contract'
import type { PayrollActualRepository } from './central-actual-contract'
import type { PayrollAdjustmentRepository } from './central-adjustment-contract'
import type { PayrollAttendanceRepository } from './central-attendance-contract'
import type { PayrollC1Repository } from './central-c1-contract'
import type { PayrollC2Repository } from './central-c2-contract'
import type { PayrollDayworkRepository } from './central-daywork-contract'
import { projectProblem, ProjectRepositoryProblem } from '../project/repository'

export const PAYROLL_READ_CAPABILITY = 'payroll:read' as const
export type PayrollJson = null | boolean | number | string | PayrollJson[] | { [key: string]: PayrollJson }
export interface PayrollJsonObject { [key: string]: PayrollJson }
export interface PayrollQuery { origin: DataOriginDTO, includeDemo?: boolean, projectId?: string, month?: string, crewId?: string }
export interface PayrollContext { workspaceId: string, actorId: string, origin: DataOriginDTO, sourceVersion: string, capabilities: readonly string[], readonly: true }
export interface PayrollWritableContext extends Omit<PayrollContext, 'readonly'> { readonly: boolean }
export interface PayrollParticipantOption { id: string, name: string | null, crewId: string | null, eligible: boolean, reasons: string[], historical: boolean, source: NavigationIntentDTO | null }
export interface PayrollCrewOption { id: string, name: string | null, eligible: boolean, reasons: string[] }
export interface PayrollParticipantOptions { projects: PayrollProjectOption[], crews: PayrollCrewOption[], workers: PayrollParticipantOption[] }
export interface PayrollSourceDiagnostic { code: string, message: string, recordId: string | null, workerId: string | null, field: string | null, tableName: string | null, entityId: string | null, legacyRecordId: string | null }
export interface PayrollDiagnostic { code: string, message: string, tableName: string | null, recordId: string | null, field: string | null }
export interface PayrollProjectOption { id: string, name: string, code: string }
export interface PayrollSnapshot {
  state: 'not-released' | 'complete' | 'partial' | 'missing' | 'invalid'
  /** 保存的快照原文及完整解析结果；不是以当前资料补齐的输出快照。 */
  raw: string | null
  originalRaw: string | null
  data: PayrollJsonObject | null
  issues: string[]
}
export interface PayrollStatementRow {
  /** 仅受控 V2 用途投影；旧 V1 保持缺字段。 */
  book?: PayrollABookRef
  id: string
  recordKind: 'central' | 'isolated'
  legacyId: string | null
  projectId: string
  projectName: string | null
  crewId: string | null
  crewName: string | null
  leaderWorkerId: string
  leaderName: string | null
  subjectConfigId: string | null
  month: string
  formatFamily: string
  periodKind: string
  purpose: string
  quantitySource: string
  status: string
  needsRecheck: boolean
  payRatio: number | null
  cumulativeAmount: number | null
  previouslyPaid: number | null
  grossAmount: number | null
  actualAmount: number | null
  checkedAt: string | null
  releasedAt: string | null
  submittedAt: string | null
  updatedAt: string | null
  deletedAt: string | null
  hidden: boolean
  sourceVersion: string
  note: string | null
  snapshot: PayrollSnapshot
  diagnostics: PayrollDiagnostic[]
}
export interface PayrollLine {
  id: string | null
  statementId: string
  workerId: string | null
  workerName: string | null
  itemId: string | null
  itemName: string | null
  unit: string | null
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  sortOrder: number | null
  deletedAt: string | null
}
export interface PayrollMember { id: string | null, statementId: string, workerId: string | null, workerName: string | null, isLeader: boolean, deletedAt: string | null }
export interface PayrollAllocation extends PayrollMember { amount: number | null, allocatedAmountFen: number | null }
export interface PayrollConfig { id: string, projectId: string, crewId: string | null, leaderWorkerId: string, formatFamily: string, unitRate: number | null, ruleText: string | null, enabled: boolean | null, updatedAt: string | null, deletedAt: string | null }
export interface PayrollAttendance { id: string, projectId: string, crewId: string | null, workerId: string, workerName: string | null, workDate: string, hours: number | null, overtimeHours: number | null, workContent: string | null, note: string | null, deletedAt: string | null }
export interface PayrollDaywork { id: string, projectId: string, crewId: string | null, workerId: string, workerName: string | null, workDate: string, workContent: string | null, startTime: string | null, endTime: string | null, laborUnits: number | null, witness: string | null, confirmedOn: string | null, status: string, note: string | null, deletedAt: string | null }
export interface PayrollDayworkLink { id: string, statementId: string, dayworkRecordId: string, deletedAt: string | null }
export interface PayrollSourceLock { projectId: string, month: string, workerId: string, statementId: string, formatFamily: 'C1' | 'C2', kind: 'released-month' | 'daywork-occupation' | 'format-exclusion', dayworkRecordId: string | null }
export interface PayrollHistoryEntry { id: string, tableName: string, recordId: string, operation: string, operatedAt: string | null, operator: string | null, beforeData: PayrollJson | null, afterData: PayrollJson | null, beforeRaw: string | null, afterRaw: string | null }
export interface PayrollIdentityMapping { tableName: string, legacyId: string, centralId: string | null }
export interface PayrollSourceEvidence { entityId: string, source: PayrollJsonObject, mappings: PayrollIdentityMapping[] }
export interface PayrollStatementDetail extends PayrollStatementRow {
  lines: PayrollLine[]
  members: PayrollMember[]
  allocations: PayrollAllocation[]
  daywork: PayrollDaywork[]
  dayworkLinks: PayrollDayworkLink[]
  /** 原关系表包含软删历史；已发呈现区不以这些当前行补缺失快照。 */
  stored: { head: PayrollJsonObject, lines: PayrollLine[], members: PayrollMember[], allocations: PayrollAllocation[], dayworkLinks: PayrollDayworkLink[] }
  locks: PayrollSourceLock[]
}
export interface PayrollListRead { context: PayrollContext, rows: PayrollStatementRow[], projects: PayrollProjectOption[], diagnostics: PayrollDiagnostic[] }
export interface PayrollDetailRead { context: PayrollContext, statement: PayrollStatementDetail, history: PayrollHistoryEntry[], evidence: PayrollSourceEvidence[] }
export interface PayrollSourcesRead { context: PayrollContext, projectId: string, configs: PayrollConfig[], attendance: PayrollAttendance[], daywork: PayrollDaywork[], locks: PayrollSourceLock[], diagnostics: PayrollDiagnostic[], history: PayrollHistoryEntry[], evidence: PayrollSourceEvidence[] }
export interface PayrollRepository extends PayrollARepository, PayrollAFeesRepository, PayrollAttendanceRepository, PayrollC1Repository, PayrollC2Repository, PayrollDayworkRepository, PayrollAdjustmentRepository, PayrollActualRepository {
  list: (query: PayrollQuery) => Promise<PayrollListRead>
  detail: (query: PayrollQuery, id: string) => Promise<PayrollDetailRead>
  sources: (query: PayrollQuery & { projectId: string }) => Promise<PayrollSourcesRead>
}
export function payrollProblem(code: Parameters<typeof projectProblem>[0], message: string, fieldErrors?: Record<string, string[]>) {
  return new ProjectRepositoryProblem({ ...projectProblem(code, message), ...(fieldErrors ? { fieldErrors } : {}) })
}
