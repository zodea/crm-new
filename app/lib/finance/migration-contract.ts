import type { CentralFinanceKind, FinanceContext } from './central-contract'

/** Only versions whose complete finance columns, guards and journal semantics were verified. */
export const FINANCE_NATIVE_SOURCE_VERSIONS = [59, 60] as const
const financeNativeSourceVersions: ReadonlySet<number> = new Set(FINANCE_NATIVE_SOURCE_VERSIONS)
export function isFinanceNativeSourceVersion(value: unknown): value is typeof FINANCE_NATIVE_SOURCE_VERSIONS[number] {
  return typeof value === 'number' && Number.isSafeInteger(value) && financeNativeSourceVersions.has(value)
}
export type FinanceMigrationEntity = 'projects' | 'suppliers' | 'workers' | 'customers'
export interface FinanceMigrationSourceProof { sha256: string, payloadBase64: string }
export interface FinanceMigrationMapping { entityType: FinanceMigrationEntity, legacyId: string, targetId: string, version: string, sourceVersion: string, reason: string }
export interface FinanceMigrationOriginal { fileId: string, payloadBase64: string }
export interface FinanceDeclaredMissingOriginal { fileId: string, reason: string }
export interface FinanceMigrationResult { commandId: string, sourceBytesSha256: string, importedAt: string, records: Array<{ kind: CentralFinanceKind, id: string, version: string }>, fileIds: string[] }
export interface FinanceMigrationState extends FinanceContext { receipts: FinanceMigrationResult[] }
export interface FinanceMigrationPreview extends FinanceContext {
  sourceBytesSha256: string
  nativeSchemaVersion: number
  eligible: boolean
  blockingReasons: string[]
  records: Array<{ kind: CentralFinanceKind, count: number, deletedCount: number }>
  references: Array<{ entityType: FinanceMigrationEntity, id: string, label: string }>
  candidates: Array<{ entityType: FinanceMigrationEntity, serverId: string, label: string, version: string, sourceVersion: string }>
  originals: Array<{ fileId: string, fileName: string, fileSize: number | null, bodyState: 'embedded' | 'metadata-only' | 'external-required', canDeclareMissingClearance: boolean, ownerId: string }>
  retainedReferences: Array<{ entityType: string, id: string, sourceAvailable: boolean }>
}
export type FinanceMigrationResolution = { outcome: 'applied', result: FinanceMigrationResult } | { outcome: 'not-applied', commandId: string }
