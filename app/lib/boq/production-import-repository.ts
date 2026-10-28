import type { CommandRecoveryDescriptor, CommandResolution } from '../forms/command-recovery'
import type { BoqSourceImportCommand, BoqSourceImportPreview, BoqSourceImportResult } from './import-contract'
import type { BoqFetcher } from './production-repository'
import { quantityProblem } from '../quantity/central-contract'
import { problemFromHttpFailure } from '../read-model/problem'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function result(value: unknown, fixed: { workspaceId: string, actorId: string, commandId: string, sourceSha256: string, importId?: string, restored?: boolean }): BoqSourceImportResult {
  if (!object(value) || !['workspaceId', 'actorId', 'commandId', 'sourceSha256'].every(field => value[field] === fixed[field as keyof typeof fixed]) || typeof value.importId !== 'string' || (fixed.importId && value.importId !== fixed.importId) || !['fileIds', 'lineIds', 'changeIds', 'priceIds'].every(field => Array.isArray(value[field]) && (value[field] as unknown[]).every(id => typeof id === 'string' && id.trim()) && new Set(value[field] as unknown[]).size === (value[field] as unknown[]).length))
    throw quantityProblem('unavailable', '原完整清单回执与原编号、来源或批次不同')
  if (fixed.restored !== undefined && !!value.restored !== fixed.restored)
    throw quantityProblem('unavailable', '原整批结果不是原采用或恢复动作')
  return structuredClone(value) as unknown as BoqSourceImportResult
}
export function createProductionBoqImportRepository(fetcher: BoqFetcher) {
  async function request<T>(url: string, options: Parameters<BoqFetcher>[1], decode: (value: unknown) => T) {
    try {
      return decode(await fetcher(url, options))
    }
    catch (cause) {
      const problem = problemFromHttpFailure(cause)
      if (problem)
        throw Object.assign(new Error(problem.message), { problem })
      throw cause
    }
  }
  return {
    state: () => request('/api/read/boq/import', undefined, (value) => {
      if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string' || !Array.isArray(value.capabilities) || !Array.isArray(value.sources) || !value.sources.every(source => object(source) && typeof source.importId === 'string' && typeof source.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(source.sourceSha256) && typeof source.restored === 'boolean' && object(source.original)))
        throw quantityProblem('unavailable', '完整清单采用状态尚未可靠读取')
      return value as unknown as { workspaceId: string, actorId: string, capabilities: string[], sources: Array<{ importId: string, sourceSha256: string, importedAt: string, restored: boolean, original: BoqSourceImportResult }> }
    }),
    preflight: (command: BoqSourceImportCommand) => request('/api/commands/boq/import/preflight', { method: 'POST', body: command }, (value) => {
      if (!object(value) || value.workspaceId !== command.workspaceId || value.actorId !== command.actorId || value.sourceSha256 !== command.source.sha256 || !Number.isSafeInteger(value.schemaVersion) || !Array.isArray(value.heads) || !value.heads.every(head => object(head) && ['id', 'projectId', 'name', 'version'].every(field => typeof head[field] === 'string')) || !Array.isArray(value.originals) || !value.originals.every(file => object(file) && ['fileId', 'fileName', 'filePath'].every(field => typeof file[field] === 'string') && typeof file.required === 'boolean' && ['embedded', 'metadata-only', 'path-original-required'].includes(String(file.bodyState))) || !object(value.counts) || !['files', 'lines', 'changes', 'prices'].every(field => Number.isSafeInteger((value.counts as Record<string, unknown>)[field]) && Number((value.counts as Record<string, unknown>)[field]) >= 0))
        throw quantityProblem('unavailable', '原清单预检与同源主合同或原件范围不同')
      return structuredClone(value) as unknown as BoqSourceImportPreview
    }),
    adopt: (command: BoqSourceImportCommand) => request('/api/commands/boq/import', { method: 'POST', body: command }, value => result(value, { ...command, sourceSha256: command.source.sha256, restored: false })),
    restore: (command: { workspaceId: string, actorId: string, commandId: string, sourceSha256: string, importId: string }) => request('/api/commands/boq/import/restore', { method: 'POST', body: command }, value => result(value, { ...command, restored: true })),
    resolve: (descriptor: CommandRecoveryDescriptor) => request('/api/commands/boq/import/resolve', { method: 'POST', body: descriptor }, (value): CommandResolution<BoqSourceImportResult> => {
      if (!object(value))
        throw quantityProblem('unavailable', '原清单整批恢复回执无效')
      if (value.outcome === 'not-applied' && value.commandId === descriptor.commandId)
        return { outcome: 'not-applied', commandId: descriptor.commandId }
      if (value.outcome !== 'applied')
        throw quantityProblem('unavailable', '原整批结果无法核对，请保留原编号')
      return { outcome: 'applied', result: result(value.result, { workspaceId: descriptor.workspaceId, actorId: descriptor.actorId, commandId: descriptor.commandId, sourceSha256: descriptor.scopeId!, restored: descriptor.action === 'restore', ...(descriptor.action === 'restore' ? { importId: descriptor.targetId! } : {}) }) }
    }),
  }
}
