import type { TransactionDb } from '../db/coordinator'
import type { QuantityHollowAction, QuantityHollowCommand, QuantityHollowCommandResult, QuantityHollowDiagnostic, QuantityHollowFact, QuantityHollowLocation, QuantityHollowParty, QuantityHollowProofRef, QuantityHollowTarget } from './central-hollow-contract'
import type { QuantityHollowResponsibilityRows, QuantityHollowTables } from './central-hollow-schema'

export interface QuantityHollowResponsibilityProof { schemaVersion: 1, target: QuantityHollowTarget, ownershipKey: string, originalParty: QuantityHollowParty, location: QuantityHollowLocation, scopeKind: 'selected' | 'whole-trade', rows: QuantityHollowResponsibilityRows }
export interface QuantityHollowLogPayload { schemaVersion: 1, recordId: string, previousLogId: string | null, action: QuantityHollowAction, revisionId: string, rectificationId: string | null, actorId: string, createdAt: string }
/** 只由 prove/extend 生成；typed 映射保留原 payloadFingerprint 和各端点 digest。 */
export interface QuantityHollowProvenStep { logId: string, receiptId: string, payload: QuantityHollowLogPayload, payloadFingerprint: string, command: QuantityHollowCommand, result: QuantityHollowCommandResult, proof: QuantityHollowProofRef }
export interface QuantityHollowProvenHistory { projectId: string, recordId: string, responsibilityFingerprint: string, responsibility: QuantityHollowResponsibilityProof, fact: QuantityHollowFact, steps: QuantityHollowProvenStep[] }
export interface QuantityHollowProofInput { projectId: string, recordId: string, tables: QuantityHollowTables }
export type QuantityHollowProofResult = { status: 'proven', history: QuantityHollowProvenHistory } | { status: 'unproven', diagnostics: QuantityHollowDiagnostic[] }
export interface QuantityHollowMigratedProof { histories: ReadonlyMap<string, QuantityHollowProvenHistory>, unavailable: readonly QuantityHollowDiagnostic[] }
export type QuantityHollowMigratedProofLoader = (tx: TransactionDb, projectId: string) => Promise<QuantityHollowMigratedProof>
export interface QuantityHollowProofOptions { migratedProof?: QuantityHollowMigratedProofLoader }
