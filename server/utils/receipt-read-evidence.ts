import type { ReadMetaDTO, SourceEvidenceDTO } from '../../app/types/read-model'
import { receiptProblem } from '../../app/lib/receipt/contract'
import { createReadMeta } from './read-meta'

/** Preserve the actual receipt scope and trusted identity while adding participating owner proof. */
export function receiptMetaWithSources(meta: ReadMetaDTO, extra: readonly SourceEvidenceDTO[]): ReadMetaDTO {
  const sources = new Map(meta.sources.map(source => [source.key, source]))
  for (const source of extra) {
    const original = sources.get(source.key)
    if (original && (original.state !== source.state || original.sourceVersion !== source.sourceVersion))
      throw receiptProblem('unavailable', '收款和合同读取期间来源已变化，请重新读取。', {}, true)
    sources.set(source.key, { ...source })
  }
  return createReadMeta({
    session: { workspaceId: meta.workspaceId, actorId: meta.actorId, capabilities: meta.capabilities },
    schemaVersion: meta.schemaVersion,
    operation: 'receipt:derived-read',
    dataOrigin: meta.dataOrigin,
    asOf: meta.asOf,
    sources: [...sources.values()],
    coverage: meta.authorizedScope.coverage,
    scope: { originalScope: meta.authorizedScope.fingerprint },
  })
}

export function sameReceiptRead(left: ReadMetaDTO, right: ReadMetaDTO): boolean {
  return left.workspaceId === right.workspaceId && left.actorId === right.actorId
    && left.dataOrigin === right.dataOrigin && left.schemaVersion === right.schemaVersion
    && left.sourceVersion === right.sourceVersion
    && JSON.stringify(left.capabilities) === JSON.stringify(right.capabilities)
    && JSON.stringify(left.authorizedScope) === JSON.stringify(right.authorizedScope)
}
