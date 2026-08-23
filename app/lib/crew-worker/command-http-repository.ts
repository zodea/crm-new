import type { CrewFormDraft, WorkerFormDraft } from '../master-data/forms'
import type {
  CrewFormReadDTO,
  CrewWorkerCommandContextDTO,
  CrewWorkerCommandRepository,
  CrewWorkerCommandResultDTO,
  WorkerFormReadDTO,
} from './command-contract'
import type { CrewWorkerHttpFetcher } from './http-repository'
import { isISODateTimeDTO } from '../../types/read-model'
import { readCrewWorkerHttp } from './http-repository'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from './repository'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalid(message: string): never {
  throw new CrewWorkerRepositoryProblem(crewWorkerProblem('internal-error', message))
}

function context(value: unknown): CrewWorkerCommandContextDTO {
  if (!object(value) || typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || !Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string')) {
    return invalid('中央后台返回的班组—工人业务会话无效')
  }
  return value as unknown as CrewWorkerCommandContextDTO
}

function result(value: unknown): CrewWorkerCommandResultDTO {
  if (!object(value) || typeof value.id !== 'string' || typeof value.commandId !== 'string'
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)
    || !Array.isArray(value.attachmentIds) || !value.attachmentIds.every(item => typeof item === 'string')) {
    return invalid('中央后台返回的班组—工人命令结果无效')
  }
  return value as unknown as CrewWorkerCommandResultDTO
}

const CREW_TEXT_FIELDS = [
  'id',
  'name',
  'trade',
  'contactName',
  'contactPhone',
  'assignmentLevel',
  'note',
  'status',
] as const satisfies readonly (keyof CrewFormDraft)[]
const CREW_NUMBER_FIELDS = ['defaultPayRatio', 'rentSubsidyPrice', 'mgmtFeePrice'] as const satisfies readonly (keyof CrewFormDraft)[]
const CREW_BOOLEAN_FIELDS = ['rentSubsidyEnabled', 'mgmtFeeEnabled'] as const satisfies readonly (keyof CrewFormDraft)[]
const CREW_ARRAY_FIELDS = ['capabilityTrades', 'capabilityItems'] as const satisfies readonly (keyof CrewFormDraft)[]

const WORKER_TEXT_FIELDS = [
  'id',
  'name',
  'gender',
  'idCard',
  'phone',
  'hometown',
  'emergencyContact',
  'emergencyPhone',
  'bankName',
  'bankAccount',
  'bankCode',
  'trade',
  'skillLevel',
  'crewId',
  'currentProjectId',
  'familyGroupId',
  'projectStatus',
  'entryDate',
  'exitDate',
  'note',
  'status',
] as const satisfies readonly (keyof WorkerFormDraft)[]
const WORKER_NUMBER_FIELDS = ['dailyWage'] as const satisfies readonly (keyof WorkerFormDraft)[]
const WORKER_BOOLEAN_FIELDS = ['safetyEducation'] as const satisfies readonly (keyof WorkerFormDraft)[]
const WORKER_ARRAY_FIELDS = ['capabilityTrades', 'capabilityItems'] as const satisfies readonly (keyof WorkerFormDraft)[]

function textFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every(field => value[field] === undefined || value[field] === null || typeof value[field] === 'string')
}

function numberFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every(field => value[field] === undefined || value[field] === null
    || (typeof value[field] === 'number' && Number.isFinite(value[field])))
}

function booleanFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every(field => value[field] === undefined || typeof value[field] === 'boolean')
}

function arrayFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every(field => value[field] === undefined
    || (Array.isArray(value[field]) && value[field].every(item => typeof item === 'string')))
}

function crewDraft(value: unknown, id: string): value is CrewFormDraft {
  return object(value) && value.id === id
    && textFields(value, CREW_TEXT_FIELDS)
    && numberFields(value, CREW_NUMBER_FIELDS)
    && booleanFields(value, CREW_BOOLEAN_FIELDS)
    && arrayFields(value, CREW_ARRAY_FIELDS)
}

function workerDraft(value: unknown, id: string): value is WorkerFormDraft {
  return object(value) && value.id === id
    && textFields(value, WORKER_TEXT_FIELDS)
    && numberFields(value, WORKER_NUMBER_FIELDS)
    && booleanFields(value, WORKER_BOOLEAN_FIELDS)
    && arrayFields(value, WORKER_ARRAY_FIELDS)
}

function crewForm(value: unknown, id: string): CrewFormReadDTO {
  if (!object(value) || !crewDraft(value.draft, id)
    || !Array.isArray(value.attachments) || value.attachments.length !== 0
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)) {
    return invalid('中央后台返回的班组表单无效')
  }
  return value as unknown as CrewFormReadDTO
}

function workerForm(value: unknown, id: string): WorkerFormReadDTO {
  if (!object(value) || !workerDraft(value.draft, id)
    || !Array.isArray(value.attachments) || value.attachments.length !== 0
    || typeof value.version !== 'string' || !isISODateTimeDTO(value.updatedAt)) {
    return invalid('中央后台返回的工人表单无效')
  }
  return value as unknown as WorkerFormReadDTO
}

export function createHttpCrewWorkerCommandRepository(options: { fetcher: CrewWorkerHttpFetcher }): CrewWorkerCommandRepository {
  return {
    context: () => readCrewWorkerHttp(() => options.fetcher('/api/read/business-session'), context),
    loadCrewForm: id => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/crews/${encodeURIComponent(id)}/form`),
      value => crewForm(value, id),
    ),
    loadWorkerForm: id => readCrewWorkerHttp(
      () => options.fetcher(`/api/read/workers/${encodeURIComponent(id)}/form`),
      value => workerForm(value, id),
    ),
    executeCrew: request => readCrewWorkerHttp(
      () => options.fetcher(request.id ? `/api/commands/crews/${encodeURIComponent(request.id)}` : '/api/commands/crews', {
        method: request.id ? 'PUT' : 'POST',
        body: { ...request },
      }),
      result,
    ),
    executeWorker: request => readCrewWorkerHttp(
      () => options.fetcher(request.id ? `/api/commands/workers/${encodeURIComponent(request.id)}` : '/api/commands/workers', {
        method: request.id ? 'PUT' : 'POST',
        body: { ...request },
      }),
      result,
    ),
  }
}
