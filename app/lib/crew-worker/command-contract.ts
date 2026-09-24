import type {
  CrewFormDraft,
  FormAttachmentChanges,
  MasterDataSaveAction,
  WorkerFormDraft,
} from '../master-data/forms'

export const CREW_WRITE_CAPABILITY = 'crew:write' as const
export const WORKER_WRITE_CAPABILITY = 'worker:write' as const

export interface CrewWorkerCommandContextDTO {
  workspaceId: string
  actorId: string
  capabilities: string[]
}

interface CommandEnvelope<TDraft> {
  id?: string
  workspaceId: string
  actorId: string
  commandId: string
  baseVersion: string | null
  action: MasterDataSaveAction
  draft: TDraft
  attachments: FormAttachmentChanges
}

export interface CrewCommandRequestDTO extends CommandEnvelope<CrewFormDraft> {
  requiredCapability: typeof CREW_WRITE_CAPABILITY
}

export interface WorkerCommandRequestDTO extends CommandEnvelope<WorkerFormDraft> {
  requiredCapability: typeof WORKER_WRITE_CAPABILITY
}

export interface CrewWorkerCommandResultDTO {
  id: string
  commandId: string
  version: string
  updatedAt: string
  attachmentIds: string[]
}

export interface CrewFormReadDTO {
  draft: CrewFormDraft & { id: string }
  attachments: []
  version: string
  updatedAt: string
}

export interface WorkerFormReadDTO {
  draft: WorkerFormDraft & { id: string }
  attachments: []
  version: string
  updatedAt: string
}

export interface CrewWorkerCommandRepository {
  context: () => Promise<CrewWorkerCommandContextDTO>
  loadCrewForm: (id: string) => Promise<CrewFormReadDTO>
  loadWorkerForm: (id: string) => Promise<WorkerFormReadDTO>
  executeCrew: (request: CrewCommandRequestDTO) => Promise<CrewWorkerCommandResultDTO>
  executeWorker: (request: WorkerCommandRequestDTO) => Promise<CrewWorkerCommandResultDTO>
}
