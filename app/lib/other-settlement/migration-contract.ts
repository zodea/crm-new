export interface OtherSettlementMigrationMapping {
  entityType: 'projects' | 'suppliers' | 'workers'
  legacyId: string
  targetId: string
  version: string
  sourceVersion: string
  reason: string
}
export interface OtherSettlementMigrationRequest {
  workspaceId: string
  actorId: string
  commandId: string
  source: {
    sha256: string
    payloadBase64: string
  }
  mappings: OtherSettlementMigrationMapping[]
}
export interface OtherSettlementMigrationResult {
  commandId: string
  sourceBytesSha256: string
  graphHash: string
  ids: string[]
  fileIds: string[]
  importedAt: string
}
