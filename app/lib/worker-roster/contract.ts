import type { WorkerSourceRow } from '../crew-worker/read-contract'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../crew-worker/read-contract'

export const WORKER_PRIVATE_READ = 'worker:sensitive:read' as const
export type WorkerPhotoPurpose = 'portrait' | 'bank-card'
export interface WorkerRosterContext { workspaceId: string, actorId: string, capabilities: string[], origin: 'real' }
export interface WorkerPhotoUpload { fileName: string, mimeType: string, fileSize: number, payloadBase64: string }
export interface WorkerPhotoAsset { id: string, workerId: string, fileName: string, mimeType: string, fileSize: number | null, sha256: string | null, createdAt: string, state: 'available' | 'missing', legacyCategory: string | null }
export interface WorkerPrivateValues { laborContractSigned: boolean | null, laborContractSignedOn: string | null, portraitId: string | null, bankCardId: string | null }
export interface WorkerPrivateProfile {
  context: WorkerRosterContext
  worker: WorkerSourceRow
  sourceVersion: string
  revision: number
  values: WorkerPrivateValues
  assets: WorkerPhotoAsset[]
  diagnostics: string[]
}
export interface WorkerRosterScope { projectId: string, statementIds: string[], registeredOn: string }
export interface WorkerRosterMember {
  workerId: string
  payrollNames: string[]
  statementIds: string[]
  isLeader: boolean
  profile: WorkerSourceRow | null
  sourceVersion: string | null
  revision: number | null
  values: WorkerPrivateValues
  photos: Array<WorkerPhotoAsset & { purpose: WorkerPhotoPurpose }>
  siteStatus: 'present' | 'left' | 'not-entered' | 'unknown'
  diagnostics: string[]
}
export interface WorkerRosterPreview {
  context: WorkerRosterContext
  scope: WorkerRosterScope
  projectName: string
  sourceVersion: string
  members: WorkerRosterMember[]
  diagnostics: string[]
  counts: { present: number, left: number, notEntered: number, unknown: number }
}
export interface WorkerRosterArchive extends WorkerRosterPreview {
  id: string
  version: number
  createdAt: string
  createdBy: string
  evidenceKind: 'dated-supplement'
}
export interface WorkerRosterArchiveSummary { id: string, version: number, projectId: string, registeredOn: string, createdAt: string, statementIds: string[], memberCount: number, gapCount: number }
interface CommandEnvelope { commandId: string, workspaceId: string, actorId: string, origin: 'real', sourceVersion: string }
export type WorkerRosterCommand = CommandEnvelope & (
  | { action: 'save-profile', workerId: string, values: WorkerPrivateValues, uploads: Partial<Record<WorkerPhotoPurpose, WorkerPhotoUpload>> }
  | { action: 'archive', scope: WorkerRosterScope }
)
export interface WorkerRosterCommandResult { commandId: string, workerId: string | null, archiveId: string | null, revision: number }
export interface WorkerRosterFile { asset: WorkerPhotoAsset, payloadBase64: string }
export type WorkerRosterResolution = { state: 'applied', result: WorkerRosterCommandResult } | { state: 'not-applied' }
export interface WorkerRosterRepository {
  profile: (workerId: string) => Promise<WorkerPrivateProfile>
  preview: (scope: WorkerRosterScope) => Promise<WorkerRosterPreview>
  execute: (command: WorkerRosterCommand) => Promise<WorkerRosterCommandResult>
  resolve: (commandId: string, action: WorkerRosterCommand['action']) => Promise<WorkerRosterResolution>
  archives: (projectId: string) => Promise<WorkerRosterArchiveSummary[]>
  archive: (projectId: string, archiveId: string) => Promise<WorkerRosterArchive>
  file: (input: { workerId: string, assetId: string, projectId?: string, archiveId?: string }) => Promise<WorkerRosterFile>
}
export function rosterProblem(code: Parameters<typeof crewWorkerProblem>[0], message: string): never {
  throw new CrewWorkerRepositoryProblem(crewWorkerProblem(code, message))
}
export const EMPTY_WORKER_PRIVATE: WorkerPrivateValues = { laborContractSigned: null, laborContractSignedOn: null, portraitId: null, bankCardId: null }
