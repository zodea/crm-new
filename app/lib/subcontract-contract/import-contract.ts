export interface SubcontractImportMapping { legacyId: string, id: string, version: string }
export interface SubcontractImportCommand {
  commandId: string
  workspaceId: string
  actorId: string
  source: { sha256: string, payloadBase64: string }
  projects: SubcontractImportMapping[]
  suppliers: SubcontractImportMapping[]
  signatories: SubcontractImportMapping[]
  originals: Array<{ fileId: string, payloadBase64: string }>
}
export interface SubcontractImportResult { commandId: string, importId: string, sourceSha256: string, ids: string[], supplementIds: string[], restored?: boolean }
export interface SubcontractImportPreview {
  sourceSha256: string
  schemaVersion: number
  contracts: Array<{ id: string, name: string, no: string, deletedAt: string | null }>
  references: Array<{ kind: 'project' | 'supplier' | 'signatory', id: string, label: string, candidates: Array<{ id: string, label: string, version: string, deletedAt: string | null }> }>
  requiredOriginals: Array<{ id: string, name: string }>
}
