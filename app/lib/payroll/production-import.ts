export type PayrollImportReferenceType = 'projects' | 'crews' | 'workers'
export interface PayrollImportReference { entityType: PayrollImportReferenceType, serverId: string, label: string, version: string, sourceVersion: string, deleted: boolean }
export interface PayrollImportMapping { entityType: PayrollImportReferenceType, legacyId: string, serverId: string, version: string, sourceVersion: string, evidenceNote: string }
export interface PayrollImportInput { workspaceId: string, actorId: string, commandId: string, action: 'preview' | 'adopt', source: { sha256: string, payloadBase64: string }, referenceMappings: PayrollImportMapping[] }
export interface PayrollImportPreview { sourceSha256: string, schemaVersion: number, eligible: boolean, projects: Array<{ legacyId: string, label: string }>, requiredReferences: Array<{ entityType: PayrollImportReferenceType, legacyId: string, label: string }>, blockingReasons: string[], diagnostics: string[] }
export interface PayrollImportResult { commandId: string, sourceSha256: string, projectIds: string[], statementIds: string[], adoptedAt: string, retainedCoordination: boolean }
export interface PayrollImportState { context: { workspaceId: string, actorId: string, capabilities: string[] }, references: PayrollImportReference[], sources: Array<{ sourceSha256: string, schemaVersion: number, adoptedAt: string }> }
