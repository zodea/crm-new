import type { NavigationIntentDTO } from '../../types/read-model'
import type { QuantityCommand, QuantityCommandResult, QuantityContext, QuantityReadResult } from './central-contract'

export interface QuantityHollowTarget { unitId: string, assignmentId: string, roomId: string, itemId: string }
export type QuantityHollowParty = { kind: 'worker', workerId: string } | { kind: 'crew', crewId: string }
export interface QuantityHollowInspectionInput { inspectedOn: string, count: number, note: string }
export type QuantityHollowAction
  = | { kind: 'create-hollow-inspection', target: QuantityHollowTarget, input: QuantityHollowInspectionInput }
    | { kind: 'revise-hollow-inspection', recordId: string, expectedRevisionId: string, input: QuantityHollowInspectionInput, reason: string }
    | { kind: 'rectify-hollow-inspection', recordId: string, expectedRevisionId: string, rectifiedOn: string, count: number, note: string }
export type QuantityHollowCommand = Omit<QuantityCommand, 'action'> & { action: QuantityHollowAction }
export interface QuantityHollowProofRef { recordId: string, revisionId: string, headLogId: string, rectificationIds: string[], fingerprint: string }
export interface QuantityHollowLocation {
  projectId: string
  buildingId: string
  floorId: string
  unitId: string
  templateId: string
  templateLineId: string
  roomId: string
  itemId: string
  buildingName: string
  floorName: string
  unitName: string
  roomName: string
  itemName: string
  locationLabel: string
}
export interface QuantityHollowRevision {
  revisionId: string
  previousRevisionId: string | null
  input: QuantityHollowInspectionInput
  reason: string | null
  commandId: string
  logId: string
  actorId: string
  createdAt: string
}
export interface QuantityHollowRectification {
  id: string
  revisionId: string
  rectifiedOn: string
  count: number
  note: string
  commandId: string
  logId: string
  actorId: string
  createdAt: string
}
export type QuantityHollowDiagnosticCode = 'target-unavailable' | 'responsibility-unproven' | 'scope-incomplete' | 'record-unproven' | 'revision-chain-invalid' | 'rectification-invalid' | 'receipt-unproven' | 'migration-unproven'
export interface QuantityHollowDiagnostic { code: QuantityHollowDiagnosticCode, message: string, recordId: string | null, target: QuantityHollowTarget | null }
export interface QuantityHollowEligibility { allowed: boolean, reasons: string[] }
export interface QuantityHollowSource { navigation: NavigationIntentDTO | null, reasons: string[] }
export interface QuantityHollowRecord {
  recordId: string
  target: QuantityHollowTarget
  originalParty: QuantityHollowParty
  originalPartyName: string
  ownershipKey: string
  location: QuantityHollowLocation
  inspection: QuantityHollowRevision
  revisions: QuantityHollowRevision[]
  rectifications: QuantityHollowRectification[]
  rectifiedCount: number
  remainingCount: number
  proof: QuantityHollowProofRef
  source: QuantityHollowSource
  eligibility: { revise: QuantityHollowEligibility, rectify: QuantityHollowEligibility }
}
export interface QuantityHollowTargetOption { target: QuantityHollowTarget, originalParty: QuantityHollowParty, originalPartyName: string, location: QuantityHollowLocation, source: QuantityHollowSource, create: QuantityHollowEligibility }
export interface QuantityHollowWorkspace { projectId: string, unitId: string, targets: QuantityHollowTargetOption[], records: QuantityHollowRecord[], unavailable: QuantityHollowDiagnostic[] }
export type QuantityHollowRead = QuantityReadResult<QuantityHollowWorkspace> & { context: QuantityContext }
export interface QuantityHollowWriteReceipt { kind: QuantityHollowAction['kind'], recordId: string, unitId: string, revisionId: string, rectificationId: string | null, logId: string, proof: QuantityHollowProofRef }
export type QuantityHollowCommandResult = QuantityCommandResult & { hollow: QuantityHollowWriteReceipt }
export type QuantityHollowFact = Omit<QuantityHollowRecord, 'eligibility' | 'source'>
export type QuantityHollowSelection = { kind: 'current', recordIds?: readonly string[] } | { kind: 'frozen', refs: readonly QuantityHollowProofRef[] }
export interface QuantityHollowFactsQuery { projectId: string, selection: QuantityHollowSelection }
export interface QuantityHollowFacts { projectId: string, sourceVersion: string, asOf: string, records: QuantityHollowFact[], unavailable: QuantityHollowDiagnostic[] }
