import type {
  CrewCommandRequestDTO,
  CrewFormReadDTO,
  CrewWorkerCommandResultDTO,
  WorkerCommandRequestDTO,
  WorkerFormReadDTO,
} from '../../app/lib/crew-worker/command-contract'
import type { CrewSourceRow, WorkerSourceRow } from '../../app/lib/crew-worker/read-contract'
import type { CrewFormDraft, WorkerFormDraft } from '../../app/lib/master-data/forms'
import type { CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { BusinessSession } from './business-session'
import { randomUUID } from 'node:crypto'
import {
  CREW_WRITE_CAPABILITY,
  WORKER_WRITE_CAPABILITY,
} from '../../app/lib/crew-worker/command-contract'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/read-contract'
import { migratedIdentityDraft, migratedIdentityRecords, migratedIdentityTimestamp } from './core-identity-migration'

interface Stored<TDraft> {
  migrationBatchId?: string | null
  id: string
  draft: TDraft
  version: number
  updatedAt: string
}

interface SessionState {
  commands: Map<string, CrewWorkerCommandResultDTO>
  crews: Map<string, Stored<CrewFormDraft>>
  workers: Map<string, Stored<WorkerFormDraft>>
  sourceVersion: number
}

interface Options {
  createId?: (kind: 'crew' | 'worker') => string
  now?: () => string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function fail(code: 'forbidden' | 'validation-failed' | 'not-found' | 'conflict', message: string, fieldErrors: Record<string, string[]> = {}): CrewWorkerRepositoryProblem {
  return new CrewWorkerRepositoryProblem({ ...crewWorkerProblem(code, message), fieldErrors })
}

function cloneDraft<T extends Record<string, any>>(draft: T): T {
  return Object.fromEntries(Object.entries(draft).map(([key, value]) => {
    if (typeof value === 'string')
      return [key, value.trim()]
    if (Array.isArray(value))
      return [key, value.map(item => typeof item === 'string' ? item.trim() : item).filter(item => item !== '')]
    return [key, value]
  })) as T
}

function assertIdentity(
  request: { workspaceId: string, actorId: string, requiredCapability: string, commandId: string },
  session: BusinessSession,
  requiredCapability: string,
) {
  if (request.workspaceId !== session.workspaceId || request.actorId !== session.actorId)
    throw fail('forbidden', '请求身份与当前会话不匹配')
  if (request.requiredCapability !== requiredCapability || !session.capabilities.includes(requiredCapability))
    throw fail('forbidden', '无班组或工人写入权限')
  if (!text(request.commandId))
    throw fail('validation-failed', 'commandId 必填', { commandId: ['commandId 必填'] })
}

function assertEmptyAttachments(attachments: CrewCommandRequestDTO['attachments']) {
  if ((attachments.add?.length ?? 0) || (attachments.removeIds?.length ?? 0) || (attachments.restoreIds?.length ?? 0))
    throw fail('validation-failed', '中央附件存储尚未接入，不能写入本地附件')
}

function lifecycle(action: CrewCommandRequestDTO['action']): string {
  return action === 'draft' ? 'draft' : 'submitted'
}

function crewRow(stored: Stored<CrewFormDraft>): CrewSourceRow {
  const draft = stored.draft
  return {
    dataOrigin: 'real',
    id: stored.id,
    name: text(draft.name),
    trade: text(draft.trade),
    tradeCapabilities: [...new Set([text(draft.trade), ...(draft.capabilityTrades ?? []).map(text)].filter(Boolean))],
    itemCapabilities: [...new Set((draft.capabilityItems ?? []).map(text).filter(Boolean))],
    contactName: text(draft.contactName),
    contactPhone: text(draft.contactPhone),
    defaultPayRatio: Number.isFinite(draft.defaultPayRatio) ? Number(draft.defaultPayRatio) : 0,
    rentSubsidyEnabled: draft.rentSubsidyEnabled === true,
    rentSubsidyPrice: draft.rentSubsidyPrice == null ? null : Number(draft.rentSubsidyPrice),
    mgmtFeeEnabled: draft.mgmtFeeEnabled === true,
    mgmtFeePrice: draft.mgmtFeePrice == null ? null : Number(draft.mgmtFeePrice),
    assignmentLevel: draft.assignmentLevel === 'worker' ? 'worker' : 'crew',
    note: text(draft.note),
    status: text(draft.status),
    updatedAt: stored.updatedAt,
  }
}

function workerRow(stored: Stored<WorkerFormDraft>): WorkerSourceRow {
  const draft = stored.draft
  return {
    dataOrigin: 'real',
    id: stored.id,
    crewId: text(draft.crewId) || null,
    currentProjectId: text(draft.currentProjectId) || null,
    linkedWorkerId: null,
    name: text(draft.name),
    gender: text(draft.gender),
    trade: text(draft.trade),
    tradeCapabilities: [...new Set([text(draft.trade), ...(draft.capabilityTrades ?? []).map(text)].filter(Boolean))],
    itemCapabilities: [...new Set((draft.capabilityItems ?? []).map(text).filter(Boolean))],
    phone: text(draft.phone),
    idCard: text(draft.idCard),
    hometown: text(draft.hometown),
    emergencyContact: text(draft.emergencyContact),
    emergencyPhone: text(draft.emergencyPhone),
    skillLevel: text(draft.skillLevel),
    dailyWage: draft.dailyWage == null ? null : Number(draft.dailyWage),
    familyGroupId: text(draft.familyGroupId) || null,
    projectStatus: text(draft.projectStatus),
    entryDate: text(draft.entryDate) || null,
    exitDate: text(draft.exitDate) || null,
    safetyEducation: draft.safetyEducation === true,
    bankName: text(draft.bankName),
    bankAccount: text(draft.bankAccount),
    bankCode: text(draft.bankCode),
    note: text(draft.note),
    status: text(draft.status),
    updatedAt: stored.updatedAt,
  }
}

export function createCrewWorkerCommandTestInstance(options: Options = {}) {
  const states = new Map<string, SessionState>()
  const createId = options.createId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = { commands: new Map(), crews: new Map(), workers: new Map(), sourceVersion: 0 }
      states.set(key, state)
    }
    return state
  }

  async function execute<TDraft extends CrewFormDraft | WorkerFormDraft>(input: {
    kind: 'crew' | 'worker'
    request: CrewCommandRequestDTO | WorkerCommandRequestDTO
    session: BusinessSession
    sessionId?: string | null
  }): Promise<CrewWorkerCommandResultDTO> {
    const requiredCapability = input.kind === 'crew' ? CREW_WRITE_CAPABILITY : WORKER_WRITE_CAPABILITY
    assertIdentity(input.request, input.session, requiredCapability)
    assertEmptyAttachments(input.request.attachments)
    const state = stateFor(input.sessionId)
    const commandKey = `${input.kind}:${input.request.commandId}`
    const duplicate = state.commands.get(commandKey)
    if (duplicate)
      return { ...duplicate, attachmentIds: [] }
    const records = (input.kind === 'crew' ? state.crews : state.workers) as Map<string, Stored<TDraft>>
    const existing = input.request.id ? records.get(input.request.id) : null
    if (input.request.id && !existing)
      throw fail('not-found', input.kind === 'crew' ? '正式班组不存在' : '正式工人不存在')
    if (!input.request.id && input.request.baseVersion !== null)
      throw fail('validation-failed', '新建命令不能带 baseVersion')
    if (existing && input.request.baseVersion !== String(existing.version))
      throw fail('conflict', input.kind === 'crew' ? '班组已被其他操作更新，请先处理最新版本' : '工人已被其他操作更新，请先处理最新版本')
    const draft = cloneDraft(input.request.draft) as TDraft
    if (input.request.action !== 'draft') {
      const errors: Record<string, string[]> = {}
      const required = input.kind === 'crew'
        ? [['name', '班组名称'], ['trade', '工种'], ['contactName', '负责人'], ['contactPhone', '联系电话']] as const
        : [['name', '姓名'], ['phone', '联系电话'], ['trade', '工种'], ['bankName', '开户银行'], ['bankAccount', '银行卡号']] as const
      for (const [field, label] of required) {
        if (!text((draft as Record<string, unknown>)[field]))
          errors[field] = [`${label}为必填项`]
      }
      if (Object.keys(errors).length)
        throw fail('validation-failed', `${input.kind === 'crew' ? '班组' : '工人'}表单校验失败`, errors)
    }
    if (input.kind === 'crew') {
      const crewDraft = draft as CrewFormDraft
      if ([...state.crews.values()].some(item => item.id !== input.request.id && text(item.draft.name) === text(crewDraft.name)))
        throw fail('validation-failed', '班组名称已存在', { name: ['班组名称已存在'] })
      crewDraft.status = lifecycle(input.request.action)
    }
    else {
      const workerDraft = draft as WorkerFormDraft
      if (workerDraft.crewId && !state.crews.has(workerDraft.crewId))
        throw fail('validation-failed', '所属班组不存在或来源不匹配', { crewId: ['所属班组不存在或来源不匹配'] })
      workerDraft.status = lifecycle(input.request.action)
    }
    const id = existing?.id ?? createId(input.kind)
    const timestamp = now()
    const stored: Stored<TDraft> = { id, draft: { ...draft, id }, version: (existing?.version ?? 0) + 1, updatedAt: timestamp, migrationBatchId: existing?.migrationBatchId ?? null }
    records.set(id, stored)
    state.sourceVersion += 1
    const result = { id, commandId: input.request.commandId, version: String(stored.version), updatedAt: timestamp, attachmentIds: [] }
    state.commands.set(commandKey, result)
    return { ...result, attachmentIds: [] }
  }

  return {
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const current = stateFor(sessionId)
      const crews = migratedIdentityRecords(current.crews, snapshot, 'crews', entity => ({ id: entity.id, draft: migratedIdentityDraft<CrewFormDraft>('crew', entity), version: 1, updatedAt: migratedIdentityTimestamp(entity) }))
      const workers = migratedIdentityRecords(current.workers, snapshot, 'workers', entity => ({ id: entity.id, draft: migratedIdentityDraft<WorkerFormDraft>('worker', entity), version: 1, updatedAt: migratedIdentityTimestamp(entity) }))
      const candidate = { ...current, crews, workers, sourceVersion: current.sourceVersion + (crews === current.crews && workers === current.workers ? 0 : 1), commands: new Map([...current.commands].filter(([, result]) => crews.has(result.id) || workers.has(result.id))) }
      return () => states.set(keyFor(sessionId), candidate)
    },
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    crewRows(sessionId?: string | null): CrewSourceRow[] {
      return [...stateFor(sessionId).crews.values()].map(crewRow)
    },
    workerRows(sessionId?: string | null): WorkerSourceRow[] {
      return [...stateFor(sessionId).workers.values()].map(workerRow)
    },
    sourceVersion(sessionId?: string | null): string {
      return `crew-worker-command-${stateFor(sessionId).sourceVersion}`
    },
    crewForm(id: string, session: BusinessSession, sessionId?: string | null): CrewFormReadDTO {
      if (!session.capabilities.includes(CREW_WRITE_CAPABILITY))
        throw fail('forbidden', '无班组写入权限')
      const stored = stateFor(sessionId).crews.get(id)
      if (!stored)
        throw fail('not-found', '正式班组不存在')
      return { draft: { ...stored.draft, id }, attachments: [], version: String(stored.version), updatedAt: stored.updatedAt }
    },
    workerForm(id: string, session: BusinessSession, sessionId?: string | null): WorkerFormReadDTO {
      if (!session.capabilities.includes(WORKER_WRITE_CAPABILITY))
        throw fail('forbidden', '无工人写入权限')
      const stored = stateFor(sessionId).workers.get(id)
      if (!stored)
        throw fail('not-found', '正式工人不存在')
      return { draft: { ...stored.draft, id }, attachments: [], version: String(stored.version), updatedAt: stored.updatedAt }
    },
    executeCrew(request: CrewCommandRequestDTO, session: BusinessSession, sessionId?: string | null) {
      return execute<CrewFormDraft>({ kind: 'crew', request, session, sessionId })
    },
    executeWorker(request: WorkerCommandRequestDTO, session: BusinessSession, sessionId?: string | null) {
      return execute<WorkerFormDraft>({ kind: 'worker', request, session, sessionId })
    },
  }
}

export const crewWorkerCommandTestInstance = createCrewWorkerCommandTestInstance()
