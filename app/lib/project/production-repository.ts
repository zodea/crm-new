import type { ProjectHttpFetcher } from './http-repository'
import type { ProjectCommandLookup, ProjectLifecycleCommand, ProjectLifecycleRead } from './production-contract'
import { isISODateTimeDTO } from '../../types/read-model'
import { decodeProjectCommandResult } from './command-http-repository'
import { readProjectHttp } from './http-repository'
import { projectProblem, ProjectRepositoryProblem } from './repository'

function invalid(): never {
  throw new ProjectRepositoryProblem(projectProblem('unavailable', '项目存储返回的身份或结果无效，请重新核对。'))
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function lifecycle(value: unknown, id?: string): ProjectLifecycleRead {
  if (!object(value) || typeof value.id !== 'string' || (id && value.id !== id) || typeof value.name !== 'string'
    || typeof value.version !== 'string' || !/^[1-9]\d*$/.test(value.version) || !Number.isSafeInteger(Number(value.version))
    || !(value.deletedAt === null || isISODateTimeDTO(value.deletedAt))) {
    return invalid()
  }
  return value as unknown as ProjectLifecycleRead
}
export function createProjectProductionRepository(fetcher: ProjectHttpFetcher, fileFetcher: (url: string) => Promise<Blob>) {
  return {
    lifecycle: (id: string) => readProjectHttp(() => fetcher(`/api/read/projects/${encodeURIComponent(id)}/lifecycle`), value => lifecycle(value, id)),
    deleted: () => readProjectHttp(() => fetcher('/api/read/projects-deleted'), value => Array.isArray(value) ? value.map(item => lifecycle(item)) : invalid()),
    execute: (request: ProjectLifecycleCommand) => readProjectHttp(() => fetcher(`/api/commands/projects/${encodeURIComponent(request.id)}/lifecycle`, { method: 'POST', body: request }), (value) => {
      const result = decodeProjectCommandResult(value)
      return result.id === request.id && result.commandId === request.commandId ? result : invalid()
    }),
    resolve: (commandId: string) => readProjectHttp(() => fetcher('/api/commands/project-resolve', { method: 'POST', body: { commandId } }), (value): ProjectCommandLookup => {
      if (!object(value) || value.commandId !== commandId)
        return invalid()
      if (value.outcome === 'not-applied' && value.result === null && value.fingerprint === null)
        return { commandId, outcome: 'not-applied', result: null, fingerprint: null }
      if (value.outcome !== 'applied' || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint))
        return invalid()
      const result = decodeProjectCommandResult(value.result)
      return result.commandId === commandId ? { commandId, outcome: 'applied', result, fingerprint: value.fingerprint } : invalid()
    }),
    file: (id: string, fileId: string) => readProjectHttp(() => fileFetcher(`/api/read/projects/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`), value => value instanceof Blob ? value : invalid()),
  }
}
