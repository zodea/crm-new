import type { ReadMetaDTO } from '../../types/read-model'
import type { OtherSettlementMigrationMapping, OtherSettlementMigrationRequest, OtherSettlementMigrationResult } from './migration-contract'
import { isTauri } from '@tauri-apps/api/core'
import { auxiliaryProblem } from '../auxiliary-contract/contract'
import { auxiliaryProblemFromUnknown } from '../auxiliary-contract/repository'
import { hasConsistentReadMeta, isReadMetaDTO } from '../read-model/meta'

export interface OtherSettlementImportPreview {
  meta: ReadMetaDTO
  sourceBytesSha256: string
  graphHash: string
  heads: Array<Record<string, unknown>>
  references: Array<{
    entityType: OtherSettlementMigrationMapping['entityType']
    legacyId: string
    label: string
  }>
  candidates: Array<{
    entityType: OtherSettlementMigrationMapping['entityType']
    serverId: string
    label: string
    version: string
    sourceVersion: string
  }>
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
function invalid(): never {
  throw auxiliaryProblem('internal-error', '结算迁入服务缺少有效原图、身份或回执证明')
}
export function decodeOtherSettlementImportResult(value: unknown): OtherSettlementMigrationResult {
  if (!object(value) || typeof value.commandId !== 'string' || !value.commandId || typeof value.sourceBytesSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceBytesSha256) || typeof value.graphHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.graphHash) || !Array.isArray(value.ids) || !Array.isArray(value.fileIds) || [...value.ids, ...value.fileIds].some(id => typeof id !== 'string' || !id) || new Set(value.ids).size !== value.ids.length || new Set(value.fileIds).size !== value.fileIds.length || typeof value.importedAt !== 'string' || !Number.isFinite(Date.parse(value.importedAt)))
    return invalid()
  return value as unknown as OtherSettlementMigrationResult
}
export function createOtherSettlementImportRepository(fetcher: (url: string, options?: object) => Promise<unknown>) {
  async function read<T>(url: string, options: object | undefined, decode: (value: unknown) => T) {
    try {
      if (isTauri())
        throw auxiliaryProblem('unavailable', '当前 Native 尚无可信中央迁入身份；请保留完整本地原库，在正式浏览器工作区核验')
      return decode(await fetcher(url, options))
    }
    catch (cause) {
      throw auxiliaryProblemFromUnknown(cause)
    }
  }
  return {
    preview: (source: OtherSettlementMigrationRequest['source']) => read('/api/commands/other-settlements/preview', { method: 'POST', body: { source } }, (value) => {
      if (!object(value) || !hasConsistentReadMeta(value, 'other-settlement-read-v1', 'real') || typeof value.sourceBytesSha256 !== 'string' || value.sourceBytesSha256 !== source.sha256 || typeof value.graphHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.graphHash) || !Array.isArray(value.heads) || !Array.isArray(value.references) || !Array.isArray(value.candidates))
        return invalid()
      if (value.references.some(row => !object(row) || !['projects', 'suppliers', 'workers'].includes(String(row.entityType)) || typeof row.legacyId !== 'string' || !row.legacyId || typeof row.label !== 'string') || value.candidates.some(row => !object(row) || !['projects', 'suppliers', 'workers'].includes(String(row.entityType)) || typeof row.serverId !== 'string' || !row.serverId || typeof row.label !== 'string' || typeof row.version !== 'string' || !/^[1-9]\d*$/.test(row.version) || typeof row.sourceVersion !== 'string' || !row.sourceVersion))
        return invalid()
      return value as unknown as OtherSettlementImportPreview
    }),
    list: () => read('/api/read/other-settlements/imports', undefined, (value) => {
      if (!object(value) || !hasConsistentReadMeta(value, 'other-settlement-read-v1', 'real') || !isReadMetaDTO(value.meta) || !Array.isArray(value.records) || value.records.some(row => !object(row) || typeof row.commandId !== 'string' || typeof row.graphHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.graphHash) || typeof row.sourceBytesSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceBytesSha256) || !Array.isArray(row.ids) || row.ids.some(id => typeof id !== 'string')))
        return invalid()
      return { meta: value.meta, records: value.records as Array<{
        commandId: string
        graphHash: string
        sourceBytesSha256: string
        ids: string[]
      }> }
    }),
    execute: (request: OtherSettlementMigrationRequest) => read('/api/commands/other-settlements/import', { method: 'POST', body: request }, (value) => {
      const result = decodeOtherSettlementImportResult(value)
      if (result.commandId !== request.commandId || result.sourceBytesSha256 !== request.source.sha256)
        return invalid()
      return result
    }),
    resolve: (commandId: string) => read('/api/commands/other-settlements/import/resolve', { method: 'POST', body: { commandId } }, (value) => {
      if (!object(value) || Object.keys(value).length !== 2)
        return invalid()
      if (value.outcome === 'not-applied' && value.commandId === commandId)
        return { outcome: 'not-applied' as const, commandId }
      if (value.outcome === 'applied') {
        const result = decodeOtherSettlementImportResult(value.result)
        if (result.commandId === commandId)
          return { outcome: 'applied' as const, result }
      }
      return invalid()
    }),
  }
}
