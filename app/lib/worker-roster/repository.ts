import type { WorkerRosterArchiveSummary, WorkerRosterCommandResult, WorkerRosterRepository } from './contract'
import { CrewWorkerRepositoryProblem } from '../crew-worker/read-contract'
import { decodeRosterArchive, decodeRosterPreview, decodeWorkerAsset, decodeWorkerProfile } from './codec'
import { rosterProblem } from './contract'
import { parseRosterScope, rosterCanonical, rosterId, rosterObject } from './validation'

export type WorkerRosterFetcher = (url: string, options?: { method?: 'POST', body?: unknown, query?: Record<string, unknown> }) => Promise<unknown>
function result(value: unknown, commandId: string): WorkerRosterCommandResult {
  if (!rosterObject(value) || value.commandId !== commandId || !(value.workerId === null || rosterId(value.workerId)) || !(value.archiveId === null || rosterId(value.archiveId)) || (value.workerId === null) === (value.archiveId === null) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
    return rosterProblem('unavailable', '提交回执身份不符，请核对结果')
  return value as unknown as WorkerRosterCommandResult
}
export function createWorkerRosterRepository(fetcher: WorkerRosterFetcher): WorkerRosterRepository {
  async function read(path: string, options?: Parameters<WorkerRosterFetcher>[1]) {
    try {
      return await fetcher(path, options)
    }
    catch (cause) {
      if (cause instanceof CrewWorkerRepositoryProblem)
        throw cause
      const outer = rosterObject(cause) && rosterObject(cause.data) ? cause.data : null
      const problem = outer && rosterObject(outer.data) ? outer.data : outer
      if (problem && ['forbidden', 'not-found', 'conflict', 'stale-source', 'validation-failed', 'unavailable', 'invalid-query'].includes(String(problem.code)) && typeof problem.message === 'string')
        return rosterProblem(problem.code as Parameters<typeof rosterProblem>[0], problem.message)
      return rosterProblem('unavailable', '名册服务暂不可用；已提交的操作须先核对结果')
    }
  }
  const base = '/api/read/worker-roster'
  return {
    async profile(workerId) {
      return decodeWorkerProfile(await read(`${base}/profile`, { query: { workerId } }), workerId)
    },
    async preview(scope) {
      const parsed = parseRosterScope(scope)
      const value = decodeRosterPreview(await read(`${base}/preview`, { method: 'POST', body: parsed }))
      if (rosterCanonical(value.scope) !== rosterCanonical(parsed))
        return rosterProblem('unavailable', '名册预览范围不符')
      return value
    },
    async execute(command) {
      return result(await read('/api/commands/worker-roster', { method: 'POST', body: command }), command.commandId)
    },
    async resolve(commandId, action) {
      const value = await read('/api/commands/worker-roster-resolve', { method: 'POST', body: { commandId, action } })
      if (rosterObject(value) && value.state === 'not-applied')
        return { state: 'not-applied' }
      if (!rosterObject(value) || value.state !== 'applied')
        return rosterProblem('unavailable', '提交结果尚不能确认')
      return { state: 'applied', result: result(value.result, commandId) }
    },
    async archives(projectId) {
      const value = await read(`${base}/archives`, { query: { projectId } })
      if (!Array.isArray(value) || value.some(row => !rosterObject(row) || !rosterId(row.id) || row.projectId !== projectId || !Number.isSafeInteger(row.version) || !Number.isSafeInteger(row.memberCount) || !Number.isSafeInteger(row.gapCount) || typeof row.createdAt !== 'string' || typeof row.registeredOn !== 'string' || !Array.isArray(row.statementIds) || !row.statementIds.every(rosterId)))
        return rosterProblem('unavailable', '名册版本列表无效')
      return value as WorkerRosterArchiveSummary[]
    },
    async archive(projectId, archiveId) {
      return decodeRosterArchive(await read(`${base}/archive`, { query: { projectId, archiveId } }), projectId, archiveId)
    },
    async file(input) {
      const value = await read(`${base}/file`, { query: input })
      if (!rosterObject(value) || typeof value.payloadBase64 !== 'string')
        return rosterProblem('unavailable', '照片原件缺少正文')
      const asset = decodeWorkerAsset(value.asset, input.workerId)
      if (asset.id !== input.assetId || asset.state !== 'available')
        return rosterProblem('unavailable', '照片原件归属不符')
      return { asset, payloadBase64: value.payloadBase64 }
    },
  }
}
