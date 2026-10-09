export interface ConstructionImportMapping { legacyId: string, id: string, version: string }
export interface ConstructionImportCommand {
  commandId: string
  workspaceId: string
  actorId: string
  source: { sha256: string, payloadBase64: string }
  projects: ConstructionImportMapping[]
  customers: ConstructionImportMapping[]
  signatories: ConstructionImportMapping[]
  originals: Array<{ fileId: string, payloadBase64: string }>
}
export interface ConstructionImportResult { commandId: string, importId: string, sourceSha256: string, ids: string[], supplementIds: string[], restored?: boolean }
export interface ConstructionImportPreview {
  sourceSha256: string
  schemaVersion: number
  contracts: Array<{ id: string, name: string, no: string, deletedAt: string | null }>
  references: Array<{ kind: 'project' | 'customer' | 'signatory', id: string, label: string, candidates: Array<{ id: string, label: string, version: string, deletedAt: string | null }> }>
  requiredOriginals: Array<{ id: string, name: string }>
}
