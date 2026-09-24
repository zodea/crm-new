import type { PayrollAFeesPhysicalProjection } from './central-a-fees-provenance'
import type { PayrollAdjustmentBasisDraft, PayrollAdjustmentRecord, PayrollOriginalWageRef } from './central-adjustment-contract'
import type { PayrollHollowAdoption, PayrollHollowCommand, PayrollHollowCommandResult, PayrollHollowPolicyRevision, PayrollHollowSnapshot, PayrollHollowStart } from './central-hollow-deduction-contract'
import type { PayrollDb } from './statements'

/** 仅由每次核验原物理集合的迁入 owner 提供；原件证明库不得注入自己。 */
export interface PayrollHollowProvenProjection {
  fees?: PayrollAFeesPhysicalProjection
  adjustments: Map<string, PayrollAdjustmentRecord>
  originals: Map<string, { original: PayrollOriginalWageRef, basis: PayrollAdjustmentBasisDraft }>
  processedVersions: Map<string, PayrollHollowProcessedVersionEntry[]>
  policyRevisions: Map<string, PayrollHollowPolicyRevision>
  policyVersions: Map<string, string[]>
  starts: Map<string, PayrollHollowStart>
  adoptions: Map<string, PayrollHollowAdoption>
  receipts: Map<string, { command: PayrollHollowCommand, result: PayrollHollowCommandResult }>
  documents: Map<string, PayrollHollowSnapshot>
  unavailableIds: Set<string>
}
export interface PayrollHollowProcessedVersionEntry {
  adoptionId: string
  adjustmentIds: string[]
  effectiveAmount: PayrollHollowSnapshot['previousProcessed'][number]['effectiveAmount']
}

export type PayrollHollowProjectionProvider = (db: PayrollDb, projectId: string) => Promise<PayrollHollowProvenProjection>

export function emptyPayrollHollowProjection(): PayrollHollowProvenProjection {
  return { adjustments: new Map(), originals: new Map(), processedVersions: new Map(), policyRevisions: new Map(), policyVersions: new Map(), starts: new Map(), adoptions: new Map(), receipts: new Map(), documents: new Map(), unavailableIds: new Set() }
}
