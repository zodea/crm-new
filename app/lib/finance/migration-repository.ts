import type { FinanceFetcher } from './http-repository'
import type { FinanceDeclaredMissingOriginal, FinanceMigrationEntity, FinanceMigrationMapping, FinanceMigrationOriginal, FinanceMigrationPreview, FinanceMigrationResolution, FinanceMigrationResult, FinanceMigrationSourceProof, FinanceMigrationState } from './migration-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { CENTRAL_FINANCE_KINDS, FINANCE_CAPABILITIES, FINANCE_IMPORT_CAPABILITY, financeFailure, financeProblemFromUnknown } from './central-contract'
import { decodeFinanceContext } from './http-repository'
import { isFinanceNativeSourceVersion } from './migration-contract'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][\w-]{2,99}$/i.test(value)
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value)
const entities: FinanceMigrationEntity[] = ['projects', 'suppliers', 'workers', 'customers']
const kindSet = new Set<string>(CENTRAL_FINANCE_KINDS)
function broken(): never {
  return financeFailure('unavailable', '财务迁入授权、原来源或回执未可靠读取，请保留原库与原提交编号。')
}
function authorized(value: unknown, operation: 'migration' | 'preflight') {
  const context = decodeFinanceContext(value, { kind: 'current', operation })
  if (![FINANCE_IMPORT_CAPABILITY, ...FINANCE_CAPABILITIES].every(cap => context.capabilities.includes(cap)))
    return broken()
  return context
}
export function decodeFinanceMigrationResult(value: unknown, commandId?: string, sourceSha?: string): FinanceMigrationResult {
  if (!object(value) || !id(value.commandId) || (commandId && value.commandId !== commandId) || !sha(value.sourceBytesSha256) || (sourceSha && value.sourceBytesSha256 !== sourceSha) || !isISODateTimeDTO(value.importedAt)
    || !Array.isArray(value.records) || value.records.some(row => !object(row) || typeof row.kind !== 'string' || !kindSet.has(row.kind) || !id(row.id) || !version(row.version))
    || new Set(value.records.map(row => `${row.kind}:${row.id}`)).size !== value.records.length
    || !Array.isArray(value.fileIds) || !value.fileIds.every(id) || new Set(value.fileIds).size !== value.fileIds.length) {
    return broken()
  }
  return value as unknown as FinanceMigrationResult
}
export function decodeFinanceMigrationState(value: unknown): FinanceMigrationState {
  authorized(value, 'migration')
  if (!object(value) || !Array.isArray(value.receipts))
    return broken()
  value.receipts.forEach(row => decodeFinanceMigrationResult(row))
  if (new Set(value.receipts.map(row => row.commandId)).size !== value.receipts.length)
    return broken()
  return value as unknown as FinanceMigrationState
}
export function decodeFinanceMigrationPreview(value: unknown, sourceSha: string): FinanceMigrationPreview {
  authorized(value, 'preflight')
  if (!object(value) || value.sourceBytesSha256 !== sourceSha || !sha(value.sourceBytesSha256) || !isFinanceNativeSourceVersion(value.nativeSchemaVersion)
    || typeof value.eligible !== 'boolean' || !Array.isArray(value.blockingReasons) || !value.blockingReasons.every(reason => typeof reason === 'string') || (value.eligible && value.blockingReasons.length)
    || !Array.isArray(value.records) || value.records.length !== CENTRAL_FINANCE_KINDS.length || value.records.some(row => !object(row) || typeof row.kind !== 'string' || !kindSet.has(row.kind) || !Number.isSafeInteger(row.count) || Number(row.count) < 0 || !Number.isSafeInteger(row.deletedCount) || Number(row.deletedCount) < 0 || Number(row.deletedCount) > Number(row.count)) || new Set(value.records.map(row => row.kind)).size !== value.records.length
    || !Array.isArray(value.references) || value.references.some(row => !object(row) || !entities.includes(row.entityType as FinanceMigrationEntity) || !id(row.id) || typeof row.label !== 'string') || new Set(value.references.map(row => `${row.entityType}:${row.id}`)).size !== value.references.length
    || !Array.isArray(value.candidates) || value.candidates.some(row => !object(row) || !entities.includes(row.entityType as FinanceMigrationEntity) || !id(row.serverId) || typeof row.label !== 'string' || !version(row.version) || typeof row.sourceVersion !== 'string' || !row.sourceVersion) || new Set(value.candidates.map(row => `${row.entityType}:${row.serverId}`)).size !== value.candidates.length
    || !Array.isArray(value.originals) || value.originals.some(row => !object(row) || !id(row.fileId) || !id(row.ownerId) || typeof row.fileName !== 'string' || !(row.fileSize === null || (Number.isSafeInteger(row.fileSize) && Number(row.fileSize) >= 0)) || typeof row.canDeclareMissingClearance !== 'boolean' || (row.canDeclareMissingClearance && row.bodyState !== 'external-required') || !['embedded', 'metadata-only', 'external-required'].includes(String(row.bodyState))) || new Set(value.originals.map(row => row.fileId)).size !== value.originals.length
    || !Array.isArray(value.retainedReferences) || value.retainedReferences.some(row => !object(row) || typeof row.entityType !== 'string' || !id(row.id) || typeof row.sourceAvailable !== 'boolean')) {
    return broken()
  }
  return value as unknown as FinanceMigrationPreview
}
export function createFinanceMigrationRepository(fetcher: FinanceFetcher) {
  async function request(url: string, options?: Parameters<FinanceFetcher>[1]) {
    try {
      return await fetcher(url, options)
    }
    catch (cause) { throw financeProblemFromUnknown(cause) }
  }
  return {
    state: async () => decodeFinanceMigrationState(await request('/api/read/finance/import')),
    preflight: async (context: { workspaceId: string, actorId: string }, source: FinanceMigrationSourceProof) => {
      const preview = decodeFinanceMigrationPreview(await request('/api/commands/finance/import/preflight', { method: 'POST', body: { workspaceId: context.workspaceId, actorId: context.actorId, source } }), source.sha256)
      if (preview.workspaceId !== context.workspaceId || preview.actorId !== context.actorId)
        return broken()
      return preview
    },
    adopt: async (context: { workspaceId: string, actorId: string }, commandId: string, source: FinanceMigrationSourceProof, mappings: FinanceMigrationMapping[], originals: FinanceMigrationOriginal[], declaredMissingOriginals: FinanceDeclaredMissingOriginal[] = []) => decodeFinanceMigrationResult(await request('/api/commands/finance/import', { method: 'POST', body: { workspaceId: context.workspaceId, actorId: context.actorId, commandId, source, mappings, originals, ...(declaredMissingOriginals.length ? { declaredMissingOriginals } : {}) } }), commandId, source.sha256),
    resolve: async (commandId: string): Promise<FinanceMigrationResolution> => {
      const value = await request('/api/commands/finance/import/resolve', { method: 'POST', body: { commandId } })
      if (!object(value))
        return broken()
      if (value.outcome === 'applied')
        return { outcome: 'applied', result: decodeFinanceMigrationResult(value.result, commandId) }
      if (value.outcome !== 'not-applied' || value.commandId !== commandId)
        return broken()
      return { outcome: 'not-applied', commandId }
    },
  }
}
