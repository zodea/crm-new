import type { ProjectHttpFetcher } from '../project/http-repository'
import type { TargetCostDetailRead, TargetCostFileRead, TargetCostFormRead, TargetCostListRead, TargetCostRepository } from './central-contract'
import { readProjectHttp } from '../project/http-repository'
import { decodeTargetCostRead, decodeTargetCostResult, encodeTargetCostWire } from './central-codec'

export function createTargetCostRepository(fetcher: ProjectHttpFetcher): TargetCostRepository {
  return {
    list: query => readProjectHttp(() => fetcher('/api/read/target-costs', { query: { ...query } }), value => decodeTargetCostRead<TargetCostListRead>(value, 'list', query)),
    form: (query, id, draftKey) => readProjectHttp(() => fetcher('/api/read/target-costs/form', { query: { ...query, id, draftKey } }), value => decodeTargetCostRead<TargetCostFormRead>(value, 'form', query, id)),
    detail: (query, id) => readProjectHttp(() => fetcher(`/api/read/target-costs/${encodeURIComponent(id)}`, { query: { ...query } }), value => decodeTargetCostRead<TargetCostDetailRead>(value, 'detail', query, id)),
    file: (query, id, fileId) => readProjectHttp(() => fetcher(`/api/read/target-costs/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`, { query: { ...query } }), value => decodeTargetCostRead<TargetCostFileRead>(value, 'file', query, id, fileId)),
    execute: command => readProjectHttp(() => fetcher('/api/commands/target-costs', { method: 'POST', body: encodeTargetCostWire(command) as Record<string, unknown> }), value => decodeTargetCostResult(value, command), command.commandId),
    resolve: descriptor => readProjectHttp(() => fetcher('/api/commands/target-costs/resolve', { method: 'POST', body: { commandId: descriptor.commandId, workspaceId: descriptor.workspaceId, actorId: descriptor.actorId } }), (value) => {
      const result = value as { outcome?: string, commandId?: string, result?: unknown }
      if (result?.outcome === 'not-applied' && result.commandId === descriptor.commandId)
        return { outcome: 'not-applied' as const, commandId: descriptor.commandId }
      if (result?.outcome === 'applied')
        return { outcome: 'applied' as const, result: decodeTargetCostResult(result.result, { commandId: descriptor.commandId, targetCostId: null }) }
      throw new Error('预算原编号恢复回执不完整')
    }, descriptor.commandId),
  }
}
