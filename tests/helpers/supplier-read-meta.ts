import type { DataOriginDTO } from '../../app/types/read-model'
import { SUPPLIER_DETAIL_READ_SCHEMA, SUPPLIER_LIST_READ_SCHEMA } from '../../app/lib/supplier/read-contract'
import { buildSupplierDetailRead as projectDetail, buildSupplierListPage as projectList } from '../../app/lib/supplier/read-page'
import { createReadMeta, readQueryScope, withOriginReadMeta, withReadMeta } from '../../server/utils/read-meta'

/** The fixture explicitly supplies trusted identity and source evidence; business expectations remain independent. */
function meta(input: Parameters<typeof projectList>[0] | Parameters<typeof projectDetail>[0], schemaVersion: string, origin: DataOriginDTO) {
  const unavailable = ('unavailableSourcesByOrigin' in input ? input.unavailableSourcesByOrigin?.[origin] : undefined) ?? input.unavailableSources ?? []
  return createReadMeta({ session: { workspaceId: 'supplier-fixture-workspace', actorId: 'supplier-fixture-actor', capabilities: input.capabilities }, schemaVersion, operation: 'supplier-fixture-read', dataOrigin: origin, asOf: input.asOf, sources: ['suppliers', 'projects', 'contracts', 'settlements', 'invoices', 'payments'].map(key => ({ key, state: unavailable.includes(key as never) ? 'unavailable' as const : 'readable' as const, sourceVersion: unavailable.includes(key as never) ? null : input.sourceVersion, asOf: unavailable.includes(key as never) ? null : input.asOf })), coverage: 'complete', scope: readQueryScope(input.query) })
}
export function buildSupplierListPage(input: Parameters<typeof projectList>[0]) {
  return withOriginReadMeta(projectList(input), { real: meta(input, SUPPLIER_LIST_READ_SCHEMA, 'real'), demo: meta(input, SUPPLIER_LIST_READ_SCHEMA, 'demo') })
}
export function buildSupplierDetailRead(input: Parameters<typeof projectDetail>[0]) {
  return withReadMeta(projectDetail(input), meta(input, SUPPLIER_DETAIL_READ_SCHEMA, input.query.origin))
}
