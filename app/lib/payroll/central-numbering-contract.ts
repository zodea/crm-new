import type { PayrollAFrozenDocument } from './central-a-contract'
import type { PayrollC1FrozenDocument } from './central-c1-contract'
import type { PayrollC2OutputDocument } from './central-c2-contract'
import type { PayrollQuery, PayrollWritableContext } from './central-contract'

export type PayrollNumberingDocument = PayrollAFrozenDocument | PayrollC1FrozenDocument | PayrollC2OutputDocument
export interface PayrollNumberingInput { projectId: string, statementId: string | null }
export interface PayrollNumberingSettings {
  id: string
  projectId: string
  firstNumber: number
  nextNumber: number
  evidenceNote: string
  initializedAt: string
  operatorId: string
}
export interface PayrollOfficialIssue {
  id: string
  projectId: string
  statementId: string
  formatFamily: 'A' | 'C1' | 'C2'
  number: string
  documentHash: string
  issuedAt: string
  operatorId: string
  commandId: string
}
export interface PayrollNumberingRead {
  context: PayrollWritableContext
  input: PayrollNumberingInput
  settings: PayrollNumberingSettings | null
  issue: PayrollOfficialIssue | null
  document: PayrollNumberingDocument | null
  eligibility: { canInitialize: boolean, canIssue: boolean, canDownload: boolean, reasons: string[] }
}
export interface PayrollNumberingCommand extends PayrollNumberingInput {
  schemaVersion: 1
  commandId: string
  workspaceId: string
  actorId: string
  origin: 'real'
  requiredCapability: 'payroll:write'
  sourceVersion: string
  action: { kind: 'initialize', nextNumber: number, evidenceNote: string } | { kind: 'issue' }
}
export interface PayrollNumberingResult {
  schemaVersion: 1
  commandId: string
  settings: PayrollNumberingSettings
  issue: PayrollOfficialIssue | null
  sourceVersion: string
}
export interface PayrollNumberingRepository {
  numbering: (query: PayrollQuery, input: PayrollNumberingInput) => Promise<PayrollNumberingRead>
  executeNumbering: (command: PayrollNumberingCommand) => Promise<PayrollNumberingResult>
}
