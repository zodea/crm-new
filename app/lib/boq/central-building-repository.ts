import type { BoqBuildingCommand, BoqBuildingContext, BoqBuildingQuery, BoqBuildingResult } from './central-building-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { readProjectHttp } from '../project/http-repository'
import { projectProblem, ProjectRepositoryProblem } from '../project/repository'

export type BoqBuildingFetcher = (url: string, options?: { method?: 'POST', query?: Record<string, unknown>, body?: BoqBuildingCommand, signal?: AbortSignal }) => Promise<unknown>
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function strings(row: Record<string, unknown>, keys: string[]) {
  return keys.every(key => typeof row[key] === 'string' && Boolean(row[key]))
}
function invalid(): never {
  throw new ProjectRepositoryProblem(projectProblem('unavailable', '清单更正服务返回无效或错配事实，请保留草稿重新读取'))
}
function rows(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(row => object(row) && strings(row, ['id'])) && new Set(value.map(row => row.id)).size === value.length
}
function nullableNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}
function context(value: unknown, query: BoqBuildingQuery): BoqBuildingContext {
  if (!object(value) || value.origin !== query.origin || value.projectId !== query.projectId || value.contractId !== query.contractId
    || !strings(value, ['workspaceId', 'actorId', 'contractName', 'sourceVersion']) || !Array.isArray(value.capabilities) || value.capabilities.some(entry => typeof entry !== 'string')
    || !rows(value.buildings) || !rows(value.lines) || !rows(value.audit)) {
    invalid()
  }
  if (value.buildings.some(row => !strings(row, ['code', 'name'])) || value.lines.some(row => !strings(row, ['itemName']) || typeof row.unit !== 'string'
    || !['qty', 'unitPrice', 'effectiveQty', 'effectiveUnitPrice'].every(key => nullableNumber(row[key]))
    || !(row.building === null || typeof row.building === 'string') || !['confirmed-import', 'change-addition', 'unknown'].includes(String(row.sourceKind))
    || !(row.readOnlyReason === null || typeof row.readOnlyReason === 'string') || (row.sourceKind !== 'confirmed-import' && !row.readOnlyReason))) {
    invalid()
  }
  if (value.audit.some(row => row.tableName !== 'boq_lines' || row.projectId !== query.projectId || row.contractId !== query.contractId || !isISODateTimeDTO(row.occurredAt)
    || !strings(row, ['lineId', 'commandId', 'actorId', 'reason', 'building', 'buildingId', 'sourceVersion']) || !(row.beforeBuilding === null || typeof row.beforeBuilding === 'string')
    || !object(row.source) || !strings(row.source, ['boqFileId']) || row.source.changeOrderId !== null || row.source.confirmed !== true)) {
    invalid()
  }
  return structuredClone(value) as unknown as BoqBuildingContext
}
export function createBoqBuildingRepository(fetcher: BoqBuildingFetcher) {
  return {
    read(query: BoqBuildingQuery, options: { signal?: AbortSignal } = {}): Promise<BoqBuildingContext> {
      const scope = { ...query }
      return readProjectHttp(() => fetcher('/api/read/boq/building-context', { query: scope, signal: options.signal }), value => context(value, scope))
    },
    execute(command: BoqBuildingCommand): Promise<BoqBuildingResult> {
      const frozen = structuredClone(command)
      return readProjectHttp(() => fetcher('/api/commands/boq-building', { method: 'POST', body: frozen }), (value) => {
        if (!object(value) || !strings(value, ['sourceVersion', 'auditId', 'building'])
          || !['commandId', 'projectId', 'contractId', 'lineId', 'buildingId'].every(key => value[key] === frozen[key as keyof BoqBuildingCommand])) {
          invalid()
        }
        return structuredClone(value) as unknown as BoqBuildingResult
      })
    },
  }
}
