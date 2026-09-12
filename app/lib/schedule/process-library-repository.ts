import type { DataOriginDTO } from '../../types/read-model'
import type { ProcessLibraryCatalog, ProcessLibraryCommandResult, ProcessLibraryCreateCommand, ProcessLibrarySummary, ProcessLibraryVersion } from './process-library-contract'
import { readProjectHttp } from '../project/http-repository'
import { processLibraryProblem } from './process-library-contract'

export interface ProcessLibraryFetchOptions {
  method?: 'POST'
  query?: Record<string, unknown>
  body?: ProcessLibraryCreateCommand
  signal?: AbortSignal
}
export type ProcessLibraryFetcher = (url: string, options?: ProcessLibraryFetchOptions) => Promise<unknown>

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalid(): never {
  throw processLibraryProblem('unavailable', '工序库服务响应无效，请重新读取')
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}
function signedInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
function nullableText(value: unknown): boolean {
  return value === null || typeof value === 'string'
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}
function summary(value: unknown, origin: DataOriginDTO): asserts value is ProcessLibrarySummary {
  if (!object(value) || value.dataOrigin !== origin || value.deletedAt !== null
    || !['id', 'code', 'name', 'description', 'sourceVersion'].every(key => typeof value[key] === 'string')
    || !value.id || !value.code || !value.name || !value.sourceVersion
    || !integer(value.version, 1) || !signedInteger(value.sortOrder) || !integer(value.taskCount)
    || !(value.usageCount === null || integer(value.usageCount)) || typeof value.isDefault !== 'boolean'
    || !['sourceVersionId', 'createdAt', 'createdBy', 'updatedAt', 'migrationBatchId', 'legacyId'].every(key => nullableText(value[key]))) {
    invalid()
  }
  if (value.usageProjects !== undefined && (!Array.isArray(value.usageProjects)
    || value.usageProjects.some(row => !object(row) || typeof row.id !== 'string' || !row.id || typeof row.name !== 'string' || !integer(row.groupCount, 1))
    || new Set(value.usageProjects.map(row => row.id)).size !== value.usageProjects.length
    || (value.usageCount !== null && value.usageProjects.reduce((sum, row) => sum + row.groupCount, 0) !== value.usageCount))) {
    invalid()
  }
}
function detail(value: unknown, id: string, origin: DataOriginDTO): ProcessLibraryVersion {
  summary(value, origin)
  const result = value as ProcessLibraryVersion
  if (result.id !== id || !Array.isArray(result.tasks) || result.taskCount !== result.tasks.length)
    invalid()
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const task of result.tasks) {
    if (!object(task) || !['id', 'key', 'name', 'trade', 'color'].every(key => typeof task[key] === 'string')
      || !task.id || !task.key || ids.has(task.id) || keys.has(task.key)
      || task.libraryId !== id || task.libraryVersion !== result.version || !signedInteger(task.sortOrder)
      || !integer(task.durationDays, 1) || task.durationDays > 365 || !strings(task.itemCodes) || task.deletedAt !== null
      || (task.stageCode !== undefined && typeof task.stageCode !== 'string')
      || !['predecessorKey', 'legacyId', 'createdAt', 'updatedAt'].every(key => nullableText(task[key]))
      || typeof task.predecessorDisabled !== 'boolean') {
      invalid()
    }
    ids.add(task.id)
    keys.add(task.key)
  }
  return structuredClone(result)
}
function catalog(value: unknown, origin: DataOriginDTO): ProcessLibraryCatalog {
  if (!object(value) || value.origin !== origin || !['workspaceId', 'actorId', 'sourceVersion'].every(key => typeof value[key] === 'string' && Boolean(value[key]))
    || !strings(value.capabilities) || !Array.isArray(value.libraries) || !object(value.seriesVersions)
    || !Object.entries(value.seriesVersions).every(([code, version]) => code.length > 0 && integer(version, 1))) {
    invalid()
  }
  const ids = new Set<string>()
  const versions = new Set<string>()
  for (const row of value.libraries) {
    summary(row, origin)
    if (!integer(value.seriesVersions[row.code], row.version))
      invalid()
    const version = JSON.stringify([row.code, row.version])
    if (ids.has(row.id) || versions.has(version))
      invalid()
    ids.add(row.id)
    versions.add(version)
  }
  return structuredClone(value) as unknown as ProcessLibraryCatalog
}
function result(value: unknown, command: ProcessLibraryCreateCommand): ProcessLibraryCommandResult {
  if (!object(value) || value.commandId !== command.commandId || typeof value.id !== 'string' || !value.id
    || !integer(value.version, 1) || value.version !== command.baseVersion + 1 || typeof value.sourceVersion !== 'string' || !value.sourceVersion) {
    invalid()
  }
  return { id: value.id, commandId: command.commandId, version: value.version, sourceVersion: value.sourceVersion }
}

export function createProcessLibraryRepository(fetcher: ProcessLibraryFetcher) {
  async function request<T>(url: string, options: ProcessLibraryFetchOptions, decode: (value: unknown) => T): Promise<T> {
    try {
      options.signal?.throwIfAborted()
      const value = await readProjectHttp(() => fetcher(url, options), decode)
      options.signal?.throwIfAborted()
      return value
    }
    catch (cause) {
      options.signal?.throwIfAborted()
      throw cause
    }
  }
  const query = (origin: DataOriginDTO) => origin === 'demo' ? { origin, includeDemo: true } : { origin }
  return {
    list: (origin: DataOriginDTO, options: { signal?: AbortSignal } = {}) => request('/api/read/process-libraries', { query: query(origin), signal: options.signal }, value => catalog(value, origin)),
    detail: (id: string, origin: DataOriginDTO, options: { signal?: AbortSignal } = {}) => request(`/api/read/process-libraries/${encodeURIComponent(id)}`, { query: query(origin), signal: options.signal }, value => detail(value, id, origin)),
    execute: (input: ProcessLibraryCreateCommand) => {
      const command = structuredClone(input)
      return request('/api/commands/process-libraries', { method: 'POST', body: command }, value => result(value, command))
    },
  }
}

export type ProcessLibraryRepository = ReturnType<typeof createProcessLibraryRepository>
