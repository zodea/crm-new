import type { CrewCommandRequestDTO, WorkerCommandRequestDTO } from '../../app/lib/crew-worker/command-contract'
import type { CrewFormDraft, FormAttachmentChanges, WorkerFormDraft } from '../../app/lib/master-data/forms'
import { CREW_WRITE_CAPABILITY, WORKER_WRITE_CAPABILITY } from '../../app/lib/crew-worker/command-contract'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/repository'

const ACTIONS = new Set(['draft', 'save', 'submit'])
const CREW_FIELDS = new Set([
  'id',
  'name',
  'trade',
  'capabilityTrades',
  'capabilityItems',
  'contactName',
  'contactPhone',
  'defaultPayRatio',
  'rentSubsidyEnabled',
  'rentSubsidyPrice',
  'mgmtFeeEnabled',
  'mgmtFeePrice',
  'assignmentLevel',
  'note',
  'status',
])
const WORKER_FIELDS = new Set([
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
  'capabilityTrades',
  'capabilityItems',
  'skillLevel',
  'dailyWage',
  'crewId',
  'currentProjectId',
  'familyGroupId',
  'projectStatus',
  'entryDate',
  'exitDate',
  'safetyEducation',
  'note',
  'status',
])
const ARRAY_FIELDS = new Set(['capabilityTrades', 'capabilityItems'])
const NUMBER_FIELDS = new Set(['defaultPayRatio', 'rentSubsidyPrice', 'mgmtFeePrice', 'dailyWage'])
const BOOLEAN_FIELDS = new Set(['rentSubsidyEnabled', 'mgmtFeeEnabled', 'safetyEducation'])
const NULLABLE_TEXT_FIELDS = new Set(['crewId', 'currentProjectId', 'familyGroupId'])

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fail(message: string): never {
  throw new CrewWorkerRepositoryProblem(crewWorkerProblem('validation-failed', message))
}

function validDraft(value: Record<string, unknown>, fields: Set<string>): boolean {
  return Object.entries(value).every(([key, field]) => {
    if (!fields.has(key))
      return false
    if (ARRAY_FIELDS.has(key))
      return Array.isArray(field) && field.every(item => typeof item === 'string')
    if (NUMBER_FIELDS.has(key))
      return field === null || (typeof field === 'number' && Number.isFinite(field))
    if (BOOLEAN_FIELDS.has(key))
      return typeof field === 'boolean'
    if (NULLABLE_TEXT_FIELDS.has(key))
      return field === null || typeof field === 'string'
    return typeof field === 'string'
  })
}

function emptyAttachmentChanges(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.every(key => ['add', 'removeIds', 'restoreIds'].includes(key))
    && keys.every(key => Array.isArray(value[key]) && value[key].length === 0)
}

function envelope(value: Record<string, unknown>, routeId: string | undefined, capability: string, label: string) {
  if (typeof value.workspaceId !== 'string' || typeof value.actorId !== 'string'
    || value.requiredCapability !== capability || typeof value.commandId !== 'string'
    || !(value.baseVersion === null || typeof value.baseVersion === 'string')
    || !ACTIONS.has(String(value.action))) {
    return fail(`${label}命令信封无效`)
  }
  if (routeId && value.id !== routeId)
    return fail(`路由${label} ID 与命令不匹配`)
  if (!routeId && value.id !== undefined)
    return fail(`新建命令不能指定${label} ID`)
}

export function parseCrewCommandRequest(value: unknown, routeId?: string): CrewCommandRequestDTO {
  if (!object(value) || !object(value.draft) || !object(value.attachments))
    return fail('班组命令请求无效')
  if (!validDraft(value.draft, CREW_FIELDS) || !emptyAttachmentChanges(value.attachments))
    return fail('班组命令内容无效；附件须通过中央附件边界处理')
  envelope(value, routeId, CREW_WRITE_CAPABILITY, '班组')
  return {
    ...(routeId ? { id: routeId } : {}),
    workspaceId: value.workspaceId as string,
    actorId: value.actorId as string,
    requiredCapability: CREW_WRITE_CAPABILITY,
    commandId: value.commandId as string,
    baseVersion: value.baseVersion as string | null,
    action: value.action as CrewCommandRequestDTO['action'],
    draft: value.draft as CrewFormDraft,
    attachments: value.attachments as FormAttachmentChanges,
  }
}

export function parseWorkerCommandRequest(value: unknown, routeId?: string): WorkerCommandRequestDTO {
  if (!object(value) || !object(value.draft) || !object(value.attachments))
    return fail('工人命令请求无效')
  if (!validDraft(value.draft, WORKER_FIELDS) || !emptyAttachmentChanges(value.attachments))
    return fail('工人命令内容无效；附件须通过中央附件边界处理')
  envelope(value, routeId, WORKER_WRITE_CAPABILITY, '工人')
  return {
    ...(routeId ? { id: routeId } : {}),
    workspaceId: value.workspaceId as string,
    actorId: value.actorId as string,
    requiredCapability: WORKER_WRITE_CAPABILITY,
    commandId: value.commandId as string,
    baseVersion: value.baseVersion as string | null,
    action: value.action as WorkerCommandRequestDTO['action'],
    draft: value.draft as WorkerFormDraft,
    attachments: value.attachments as FormAttachmentChanges,
  }
}
