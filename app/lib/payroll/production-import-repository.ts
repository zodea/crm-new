import type { PayrollImportInput, PayrollImportPreview, PayrollImportResult, PayrollImportState } from './production-import'
import { isISODateTimeDTO } from '../../types/read-model'
import { isStableRouteIdentity } from '../util/stable-route-identity'

type Fetcher = (url: string, options?: { method?: 'GET' | 'POST', body?: object }) => Promise<unknown>
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function invalid(): never {
  throw new Error('工资来源、明确映射或原回执格式无法核实，请保留原文件与原编号。')
}
export function decodePayrollImportResult(value: unknown, commandId?: string, sourceSha256?: string): PayrollImportResult {
  if (!object(value) || !isStableRouteIdentity(value.commandId) || (commandId && commandId !== value.commandId) || !sha(value.sourceSha256) || (sourceSha256 && sourceSha256 !== value.sourceSha256) || !Array.isArray(value.projectIds) || !value.projectIds.every(isStableRouteIdentity) || !Array.isArray(value.statementIds) || !value.statementIds.every(isStableRouteIdentity) || !isISODateTimeDTO(value.adoptedAt) || typeof value.retainedCoordination !== 'boolean')
    invalid()
  return value as unknown as PayrollImportResult
}
export function createPayrollImportRepository(fetcher: Fetcher) {
  return {
    async state(): Promise<PayrollImportState> {
      const value = await fetcher('/api/read/payroll/import')
      if (!object(value) || !object(value.context) || !isStableRouteIdentity(value.context.workspaceId) || !isStableRouteIdentity(value.context.actorId) || !Array.isArray(value.context.capabilities) || !['payroll:read', 'payroll:write', 'core:migration:write'].every(capability => value.context && (value.context as { capabilities: unknown[] }).capabilities.includes(capability)) || !Array.isArray(value.references) || value.references.some(row => !object(row) || !['projects', 'crews', 'workers'].includes(String(row.entityType)) || !isStableRouteIdentity(row.serverId) || typeof row.label !== 'string' || typeof row.version !== 'string' || !/^[1-9]\d*$/.test(row.version) || typeof row.sourceVersion !== 'string' || !row.sourceVersion || typeof row.deleted !== 'boolean') || !Array.isArray(value.sources) || value.sources.some(row => !object(row) || !sha(row.sourceSha256) || !Number.isSafeInteger(row.schemaVersion) || !isISODateTimeDTO(row.adoptedAt)))
        invalid()
      return value as unknown as PayrollImportState
    },
    async preview(input: PayrollImportInput): Promise<PayrollImportPreview> {
      const value = await fetcher('/api/commands/payroll-import', { method: 'POST', body: { ...input, action: 'preview' } })
      if (!object(value) || value.sourceSha256 !== input.source.sha256 || !Number.isSafeInteger(value.schemaVersion) || typeof value.eligible !== 'boolean' || !Array.isArray(value.projects) || value.projects.some(row => !object(row) || !isStableRouteIdentity(row.legacyId) || typeof row.label !== 'string') || !Array.isArray(value.requiredReferences) || value.requiredReferences.some(row => !object(row) || !['projects', 'crews', 'workers'].includes(String(row.entityType)) || !isStableRouteIdentity(row.legacyId) || typeof row.label !== 'string') || !Array.isArray(value.blockingReasons) || !value.blockingReasons.every(row => typeof row === 'string') || !Array.isArray(value.diagnostics) || !value.diagnostics.every(row => typeof row === 'string'))
        invalid()
      return value as unknown as PayrollImportPreview
    },
    async adopt(input: PayrollImportInput) {
      return decodePayrollImportResult(await fetcher('/api/commands/payroll-import', { method: 'POST', body: { ...input, action: 'adopt' } }), input.commandId, input.source.sha256)
    },
    async resolve(commandId: string): Promise<{ outcome: 'applied', result: PayrollImportResult } | { outcome: 'not-applied', commandId: string }> {
      const value = await fetcher('/api/commands/payroll-import-resolve', { method: 'POST', body: { commandId } })
      if (!object(value))
        invalid()
      if (value.outcome === 'applied')
        return { outcome: 'applied', result: decodePayrollImportResult(value.result, commandId) }
      if (value.outcome !== 'not-applied' || value.commandId !== commandId)
        invalid()
      return { outcome: 'not-applied', commandId }
    },
  }
}
