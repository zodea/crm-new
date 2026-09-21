import type { QuantityHollowResponsibilityTable, QuantityHollowTable, QuantityHollowTables } from './central-hollow-schema'

export type QuantityHollowIdentityTable = QuantityHollowTable | QuantityHollowResponsibilityTable
export interface QuantityHollowCommandKey { workspaceId: string, actorId: string, commandId: string }
export type QuantityHollowIdentityBinding
  = | { kind: 'row', table: QuantityHollowIdentityTable, sourceId: string, exportedId: string }
    | { kind: 'command', source: QuantityHollowCommandKey, exported: QuantityHollowCommandKey }
export interface QuantityHollowOriginBinding { originId: string, identities: QuantityHollowIdentityBinding[] }
export interface QuantityHollowOrigin { id: string, bodyJson: string }
export interface QuantityHollowOriginBody {
  schemaVersion: 1
  kind: 'root' | 'suffix'
  projectId: string
  recordId: string
  base: null | { originId: string, recordId: string, headLogId: string, fingerprint: string }
  tables: QuantityHollowTables
}
export interface QuantityHollowRowOrigin { table: QuantityHollowTable, exportedId: string, originId: string, sourceId: string }
export interface QuantityHollowMigrationGraph {
  schemaVersion: 1
  tables: QuantityHollowTables
  origins: QuantityHollowOrigin[]
  bindings: QuantityHollowOriginBinding[]
  rowOrigins: QuantityHollowRowOrigin[]
}

export interface QuantityHollowMigrationEvidence {
  entity_id: string
  project_id: string
  batch_id: string
  source_package_json: string
  source_fingerprint: string
  mapped_package_json: string
}
