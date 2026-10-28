import type { QuotationGraph, QuotationImportResult } from './graph'
import type { QuotationImportBinding, QuotationMigrationSource } from './import-evidence'
import { isISODateTimeDTO } from '../../types/read-model'
import { hasConsistentReadMeta, isReadMetaDTO } from '../read-model/meta'
import { isObject, quotationProblem, validId } from './contract'
import { quotationUnknownProblem } from './http-repository'
import { decodeQuotationMigrationReference } from './import-evidence'

export function decodeQuotationImportResult(value: unknown): QuotationImportResult {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'batchId,commandId,graphHash,importedIds,updatedAt' || !validId(value.batchId) || !validId(value.commandId) || typeof value.graphHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.graphHash) || !isISODateTimeDTO(value.updatedAt) || !Array.isArray(value.importedIds) || value.importedIds.some(id => !validId(id)) || new Set(value.importedIds).size !== value.importedIds.length)
    return quotationProblem('internal-error', '报价迁入回执的批次、原编号或图摘要无效')
  return value as unknown as QuotationImportResult
}
export interface QuotationImportRequest {
  workspaceId: string
  actorId: string
  requiredCapability: 'core:migration:write'
  commandId: string
  batchId: string
  graphHash: string
  graph: QuotationGraph
  source: QuotationMigrationSource
  bindings: QuotationImportBinding[]
}
export function createQuotationImportRepository(fetcher: (url: string, options?: object) => Promise<unknown>) {
  async function read<T>(load: () => Promise<unknown>, decode: (value: unknown) => T): Promise<T> {
    try {
      return decode(await load())
    }
    catch (cause) {
      throw quotationUnknownProblem(cause)
    }
  }
  return {
    context: () => read(() => fetcher('/api/read/material-quotations/import-context'), (value) => {
      if (!isObject(value) || Object.keys(value).sort().join(',') !== 'actorId,asOf,capabilities,meta,references,sourceVersion,workspaceId' || !hasConsistentReadMeta(value, 'material-quotation-import-context-v1', 'real') || !isReadMetaDTO(value.meta, 'material-quotation-import-context-v1') || value.workspaceId !== value.meta.workspaceId || value.actorId !== value.meta.actorId || !Array.isArray(value.references))
        return quotationProblem('internal-error', '报价迁入关联目录缺少当前身份和实际读取证明')
      const references = value.references.map(decodeQuotationMigrationReference)
      if (new Set(references.map(row => `${row.entityType}:${row.serverId}`)).size !== references.length)
        return quotationProblem('internal-error', '报价迁入目标目录稳定身份重复')
      return { workspaceId: value.meta.workspaceId, actorId: value.meta.actorId, capabilities: [...value.meta.capabilities], references, meta: value.meta }
    }),
    list: () => read(() => fetcher('/api/read/material-quotations/imports'), (value) => {
      if (!isObject(value) || Object.keys(value).sort().join(',') !== 'asOf,capabilities,meta,records,sourceVersion' || !hasConsistentReadMeta(value, 'material-quotation-import-read-v1', 'real') || !isReadMetaDTO(value.meta, 'material-quotation-import-read-v1') || !Array.isArray(value.records))
        return quotationProblem('internal-error', '报价迁入核验缺少本次实际读取证明')
      return { records: value.records.map(decodeQuotationImportResult), meta: value.meta }
    }),
    execute: (body: QuotationImportRequest) => read(() => fetcher('/api/commands/material-quotations/import', { method: 'POST', body }), (value) => {
      const result = decodeQuotationImportResult(value)
      if (result.commandId !== body.commandId || result.graphHash !== body.graphHash || result.batchId !== body.batchId)
        return quotationProblem('internal-error', '报价迁入回执不属于本次原编号、批次或完整图')
      return result
    }),
    resolve: (commandId: string) => read(() => fetcher('/api/commands/material-quotations/import/resolve', { method: 'POST', body: { commandId } }), (value) => {
      if (!isObject(value) || Object.keys(value).length !== 2)
        return quotationProblem('internal-error', '报价迁入原编号核对结果无效')
      if (value.outcome === 'not-applied' && value.commandId === commandId)
        return { outcome: 'not-applied' as const, commandId }
      if (value.outcome === 'applied') {
        const result = decodeQuotationImportResult(value.result)
        if (result.commandId === commandId)
          return { outcome: 'applied' as const, result }
      }
      return quotationProblem('internal-error', '报价迁入回执不属于当前原编号')
    }),
  }
}
