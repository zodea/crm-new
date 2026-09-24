import type { DataOriginDTO } from '../../types/read-model'
import type { PAYROLL_WRITE_CAPABILITY } from './central-a-contract'
import type { PayrollABookRef } from './central-a-fees-contract'
import type { PayrollARoundingRule } from './central-batch-contract'
import type { PayrollQuery, PayrollWritableContext } from './central-contract'

export interface PayrollARoundingScope {
  projectId: string
  leaderWorkerId: string
  book: PayrollABookRef
  month: string
}

export interface PayrollARoundingRevision {
  id: string
  projectId: string
  leaderWorkerId: string
  book: PayrollABookRef
  effectiveMonth: string
  revision: number
  rule: PayrollARoundingRule
  operatorId: string
  createdAt: string
  sourceVersion: string
}

export interface PayrollARoundingRead {
  context: PayrollWritableContext
  scope: PayrollARoundingScope
  current: PayrollARoundingRevision | null
  revisions: PayrollARoundingRevision[]
  readonlyReasons: string[]
}

export interface PayrollARoundingCommand {
  schemaVersion: 1
  commandId: string
  workspaceId: string
  actorId: string
  origin: DataOriginDTO
  requiredCapability: typeof PAYROLL_WRITE_CAPABILITY
  sourceVersion: string
  scope: PayrollARoundingScope
  action: { kind: 'save-a-rounding', rule: PayrollARoundingRule }
}

export interface PayrollARoundingCommandResult {
  schemaVersion: 1
  commandId: string
  revision: PayrollARoundingRevision
  sourceVersion: string
}

export interface PayrollARoundingRepository {
  aRounding: (query: PayrollQuery, scope: PayrollARoundingScope) => Promise<PayrollARoundingRead>
  executeARounding: (command: PayrollARoundingCommand) => Promise<PayrollARoundingCommandResult>
}
