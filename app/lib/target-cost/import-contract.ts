export interface BudgetImportMapping { legacyProjectId: string, projectId: string, version: string }
export interface BudgetImportCommand {
  commandId: string
  workspaceId: string
  actorId: string
  source: { sha256: string, payloadBase64: string }
  mappings: BudgetImportMapping[]
  originals?: Array<{ fileId: string, payloadBase64: string }>
}
export interface BudgetImportPreview {
  sourceSha256: string
  schemaVersion: number
  versions: Array<{ id: string, name: string, legacyProjectId: string | null }>
  references: Array<{ id: string, name: string }>
  projects: Array<{ id: string, name: string, version: string, deletedAt: string | null }>
  requiredOriginals: Array<{ id: string, name: string }>
}
export interface BudgetImportResult { commandId: string, importId: string, ids: string[], sourceSha256: string, restored?: boolean }
