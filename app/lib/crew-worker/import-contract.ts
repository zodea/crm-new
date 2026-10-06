import type { CoreMigrationIdMappingDTO } from '../migration/core-contract'

export const CREW_WORKER_IMPORT_SCHEMA_RANGE = { min: 47, max: 60 } as const

export interface CrewWorkerImportReferenceMapping extends CoreMigrationIdMappingDTO {
  entityType: 'projects'
  version: string
}
export interface CrewWorkerImportSource { sha256: string, payloadBase64: string }
export interface CrewWorkerImportCommand {
  workspaceId: string
  actorId: string
  commandId: string
  action: 'preflight' | 'adopt'
  source: CrewWorkerImportSource
  referenceMappings: CrewWorkerImportReferenceMapping[]
}
export interface CrewWorkerImportResult {
  commandId: string
  sourceSha256: string
  schemaVersion: number
  crewIds: string[]
  workerIds: string[]
  originalCount: number
  archiveIds: string[]
  adoptedAt: string
}
export interface CrewWorkerImportPreview {
  sourceSha256: string
  schemaVersion: number
  crews: Array<{ id: string, name: string, deleted: boolean }>
  workers: Array<{ id: string, name: string, deleted: boolean }>
  projects: Array<{ legacyId: string, label: string }>
  originalCount: number
  archiveCount: number
  eligible: boolean
  blockingReasons: string[]
}
export type CrewWorkerImportResolution = { outcome: 'applied', result: CrewWorkerImportResult } | { outcome: 'not-applied', commandId: string }
