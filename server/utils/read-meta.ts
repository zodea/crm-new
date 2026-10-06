import type { AuthorizedScopeDTO, DataOriginDTO, ReadMetaDTO, SourceEvidenceDTO } from '../../app/types/read-model'
import type { BusinessSession } from './business-session'
import { createHash } from 'node:crypto'
import { isReadMetaDTO } from '../../app/lib/read-model/meta'

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')

/** The trusted owner supplies actual participating sources and a consistent read point, never client identity. */
export function createReadMeta(input: {
  session: BusinessSession
  schemaVersion: string
  operation: string
  dataOrigin: DataOriginDTO
  asOf: string
  sources: readonly SourceEvidenceDTO[]
  coverage: AuthorizedScopeDTO['coverage']
  scope: unknown
}): ReadMetaDTO {
  const capabilities = [...new Set(input.session.capabilities)].sort()
  const sources = input.sources.map(source => ({ ...source })).sort((a, b) => a.key.localeCompare(b.key))
  const result = {
    schemaVersion: input.schemaVersion,
    workspaceId: input.session.workspaceId,
    actorId: input.session.actorId,
    dataOrigin: input.dataOrigin,
    asOf: input.asOf,
    sourceVersion: sources.some(source => source.state === 'readable') && !sources.some(source => source.state === 'readable' && source.sourceVersion === null)
      ? `read-${digest(sources.map(({ key, state, sourceVersion }) => ({ key, state, sourceVersion })))}`
      : null,
    sources,
    authorizedScope: { coverage: input.coverage, fingerprint: `scope-${digest({ operation: input.operation, workspaceId: input.session.workspaceId, actorId: input.session.actorId, dataOrigin: input.dataOrigin, capabilities, scope: input.scope })}` },
    capabilities,
  }
  if (!isReadMetaDTO(result))
    throw new Error('读取证据或可信范围不完整')
  return result
}

export { attachOriginReadMeta as withOriginReadMeta, attachReadMeta as withReadMeta } from '../../app/lib/read-model/meta'

export function readQueryScope<T extends object>(query: T) {
  return Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'page' && key !== 'pageSize'))
}

/** Owner snapshots without a monotonic revision still bind every participating fact. */
export function readSourceVersion(key: string, snapshot: unknown): string {
  return `${key}:${digest(snapshot)}`
}
