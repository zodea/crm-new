import type { DataOriginDTO, ReadMetaDTO } from '../../app/types/read-model'
import { buildMaterialContractDetail as projectDetail, buildMaterialContractListPage as projectList } from '../../app/lib/material-contract/read-page'
import { createReadMeta, withOriginReadMeta, withReadMeta } from '../../server/utils/read-meta'

/** Explicit trusted fixture identity; runtime adapters must supply their actual session. */
export function materialReadMeta(capabilities: readonly string[], version: string, origin: DataOriginDTO = 'real', asOf = '2026-08-24T00:00:00.000Z') {
  return createReadMeta({ session: { workspaceId: 'material-fixture-workspace', actorId: 'material-fixture-actor', capabilities }, schemaVersion: 'material-contract-read-v2', operation: 'material-fixture:read', dataOrigin: origin, asOf, sources: [{ key: `material-fixture-${origin}`, state: 'readable', sourceVersion: version, asOf }], coverage: 'complete', scope: { fixture: 'material-contract' } })
}

export function materialOriginMeta(capabilities: readonly string[], version: string, asOf?: string) {
  return { real: materialReadMeta(capabilities, version, 'real', asOf), demo: materialReadMeta(capabilities, version, 'demo', asOf) }
}

export function buildMaterialContractDetail(input: Omit<Parameters<typeof projectDetail>[0], 'asOf' | 'sourceVersion' | 'capabilities'> & { meta: ReadMetaDTO }) {
  return withReadMeta(projectDetail({ ...input, ...input.meta }), input.meta)
}

export function buildMaterialContractListPage(input: Omit<Parameters<typeof projectList>[0], 'asOf' | 'sourceVersion' | 'capabilities'> & { originMeta: Record<DataOriginDTO, ReadMetaDTO> }) {
  const origin = input.query.origin ?? 'real'
  return withOriginReadMeta(projectList({ ...input, ...input.originMeta[origin] }), input.originMeta, origin)
}
