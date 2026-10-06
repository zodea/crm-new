import type { ProjectDetailQueryDTO, ProjectListQueryDTO, ProjectListSourceRow } from '../../app/lib/project/read-contract'
import type { DataOriginDTO } from '../../app/types/read-model'
import { createReadMeta, readQueryScope, readSourceVersion } from '../../server/utils/read-meta'

/** Explicit immutable owner of the SQL/HTTP fixture snapshot; never used by a runtime adapter. */
export function projectSnapshotEvidence(input: { rows: readonly ProjectListSourceRow[], query: ProjectListQueryDTO | ProjectDetailQueryDTO, asOf: string, capabilities?: readonly string[] }) {
  const session = { workspaceId: 'project-fixture-workspace', actorId: 'project-fixture-actor', capabilities: input.capabilities ?? ['project:list:read', 'demo:read'] }
  const evidence = (origin: DataOriginDTO) => createReadMeta({ session, schemaVersion: 'project-read-v2', operation: 'project-fixture:read', dataOrigin: origin, asOf: input.asOf, sources: [{ key: 'fixture-snapshot', state: 'readable', sourceVersion: readSourceVersion('project-fixture', input.rows), asOf: input.asOf }], coverage: 'complete', scope: readQueryScope(input.query) })
  return { real: evidence('real'), demo: evidence('demo') }
}

/** Related customer facts explicitly owned by this immutable project fixture. */
export async function fixtureProjectCustomerReferences(rows: readonly ProjectListSourceRow[]) {
  const references = rows.map(row => ({ id: row.id, origin: row.dataOrigin, customerId: row.customerId, customerName: row.customerName, customerPermission: row.customerPermission, secondaryCustomerId: row.secondaryCustomerId, secondaryCustomerName: row.secondaryCustomerName, secondaryCustomerPermission: row.secondaryCustomerPermission }))
  return { rows, source: { key: 'customers', state: 'readable' as const, sourceVersion: readSourceVersion('fixture-customer-references', references), asOf: '2026-08-15T00:00:00.000Z' } }
}
