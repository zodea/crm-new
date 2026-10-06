import type { ReadMetaDTO } from '../../types/read-model'
import { isDataOriginDTO, isISODateTimeDTO } from '../../types/read-model'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key))
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
export function isReadMetaDTO(value: unknown, schemaVersion?: string): value is ReadMetaDTO {
  if (!object(value) || !keys(value, ['schemaVersion', 'workspaceId', 'actorId', 'dataOrigin', 'asOf', 'sourceVersion', 'sources', 'authorizedScope', 'capabilities'])
    || !text(value.schemaVersion) || (schemaVersion !== undefined && value.schemaVersion !== schemaVersion)
    || !text(value.workspaceId) || !text(value.actorId) || !isDataOriginDTO(value.dataOrigin) || !isISODateTimeDTO(value.asOf)
    || !(value.sourceVersion === null || text(value.sourceVersion))
    || !Array.isArray(value.capabilities) || !value.capabilities.every(text) || new Set(value.capabilities).size !== value.capabilities.length
    || !object(value.authorizedScope) || !keys(value.authorizedScope, ['coverage', 'fingerprint'])
    || !['complete', 'permission-filtered', 'unknown'].includes(String(value.authorizedScope.coverage))
    || !text(value.authorizedScope.fingerprint) || !Array.isArray(value.sources)) {
    return false
  }
  const seen = new Set<string>()
  const validSources = value.sources.every((source) => {
    if (!object(source) || !keys(source, ['key', 'state', 'sourceVersion', 'asOf']) || !text(source.key) || seen.has(source.key)
      || !['readable', 'forbidden', 'unavailable', 'not-requested'].includes(String(source.state))
      || !(source.sourceVersion === null || text(source.sourceVersion))
      || !(source.asOf === null || isISODateTimeDTO(source.asOf))
      || (source.state === 'readable' ? source.asOf === null : source.asOf !== null || source.sourceVersion !== null)) {
      return false
    }
    seen.add(source.key)
    return true
  })
  if (!validSources)
    return false
  const readable = value.sources.filter(source => source.state === 'readable')
  return readable.length > 0 && readable.every(source => source.sourceVersion !== null)
    ? value.sourceVersion !== null
    : value.sourceVersion === null
}

/** Compatibility fields mirror this generation's metadata; they cannot make a stale envelope current. */
export function hasConsistentReadMeta(value: unknown, schemaVersion: string, origin?: unknown): boolean {
  if (!object(value) || !isReadMetaDTO(value.meta, schemaVersion))
    return false
  const meta = value.meta
  return (origin === undefined || meta.dataOrigin === origin)
    && value.asOf === meta.asOf && value.sourceVersion === meta.sourceVersion
    && Array.isArray(value.capabilities) && JSON.stringify(value.capabilities) === JSON.stringify(meta.capabilities)
}

export function hasConsistentOriginReadMeta(value: unknown, schemaVersion: string): boolean {
  if (!object(value) || !hasConsistentReadMeta(value, schemaVersion) || !isReadMetaDTO(value.meta) || !object(value.originMeta)
    || !keys(value.originMeta, ['real', 'demo'])) {
    return false
  }
  const main = value.meta
  const origins = value.originMeta
  return (['real', 'demo'] as const).every((origin) => {
    const meta = origins[origin]
    return isReadMetaDTO(meta, schemaVersion) && meta.dataOrigin === origin && meta.workspaceId === main.workspaceId
      && meta.actorId === main.actorId && meta.asOf === main.asOf
      && (main.dataOrigin !== origin || JSON.stringify(main) === JSON.stringify(meta))
  })
}

export function attachReadMeta<T extends object>(projection: T, meta: ReadMetaDTO): T & { meta: ReadMetaDTO, asOf: string, sourceVersion: string | null, capabilities: string[] } {
  if (!isReadMetaDTO(meta))
    throw new Error('读取证据无效')
  return { ...projection, asOf: meta.asOf, sourceVersion: meta.sourceVersion, capabilities: [...meta.capabilities], meta }
}

export function attachOriginReadMeta<T extends object>(projection: T, originMeta: Record<'real' | 'demo', ReadMetaDTO>, origin: 'real' | 'demo' = 'real') {
  if (originMeta.real.dataOrigin !== 'real' || originMeta.demo.dataOrigin !== 'demo'
    || originMeta.real.workspaceId !== originMeta.demo.workspaceId || originMeta.real.actorId !== originMeta.demo.actorId
    || originMeta.real.asOf !== originMeta.demo.asOf) {
    throw new Error('分来源读取证据不能混合身份或时点')
  }
  return { ...attachReadMeta(projection, originMeta[origin]), originMeta }
}
