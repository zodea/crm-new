import type { DataOriginDTO } from '../../app/types/read-model'
import { createReadMeta } from '../../server/utils/read-meta'

/** Explicit trusted fixture identity and evidence. Runtime owners supply their actual BusinessSession. */
export function publicReadMeta(input: {
  schemaVersion: string
  dataOrigin: DataOriginDTO
  asOf: string
  sourceVersion: string | null
  capabilities: readonly string[]
  scope: unknown
  requested: boolean
}) {
  return createReadMeta({
    session: { workspaceId: 'public-read-fixture-workspace', actorId: 'public-read-fixture-actor', capabilities: input.capabilities },
    schemaVersion: input.schemaVersion,
    operation: 'public-read-fixture',
    dataOrigin: input.dataOrigin,
    asOf: input.asOf,
    coverage: input.requested ? 'complete' : 'unknown',
    scope: input.scope,
    sources: [{ key: `fixture-${input.dataOrigin}`, state: input.requested ? 'readable' : 'not-requested', sourceVersion: input.requested ? input.sourceVersion : null, asOf: input.requested ? input.asOf : null }],
  })
}
