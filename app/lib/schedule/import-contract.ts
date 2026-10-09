export interface WbsReferenceMapping { table: 'projects' | 'buildings' | 'floors' | 'items' | 'construction_stages', legacyId: string, id: string, version: string }
export interface WbsLibraryMapping { legacyId: string, id: string, version: string }
export interface WbsImportCommand {
  action: 'preflight' | 'adopt'
  commandId: string
  workspaceId: string
  actorId: string
  source: { sha256: string, payloadBase64: string }
  references: WbsReferenceMapping[]
  libraries: WbsLibraryMapping[]
  originals: Array<{ fileId: string, payloadBase64: string }>
}
export interface WbsImportResult { commandId: string, importId: string, sourceSha256: string, projectIds: string[], groupIds: string[], taskIds: string[], restored?: boolean }
export interface WbsImportPreview {
  sourceSha256: string
  schemaVersion: number
  projects: Array<{ id: string, name: string, groups: number, tasks: number, deletedAt: string | null }>
  references: Array<{ table: WbsReferenceMapping['table'], id: string, projectId: string, name: string, deletedAt: string | null, candidates: Array<{ id: string, projectId: string, name: string, deletedAt: string | null, version: string }> }>
  libraries: Array<{ id: string, code: string, name: string, version: number, candidates: Array<{ id: string, name: string, version: string }> }>
  requiredOriginals: Array<{ id: string, name: string }>
}
