import type {
  CrewCommandRequestDTO,
  CrewFormReadDTO,
  CrewWorkerCommandResultDTO,
  WorkerCommandRequestDTO,
  WorkerFormReadDTO,
} from '../../app/lib/crew-worker/command-contract'
import type { CrewPayrollFeeValues } from '../../app/lib/crew-worker/payroll-fee-defaults'
import type { CrewSourceRow, WorkerSourceRow } from '../../app/lib/crew-worker/read-contract'
import type { CrewFormDraft, WorkerFormDraft } from '../../app/lib/master-data/forms'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type { PayrollCrewFeeDefaults } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollWorkerFact } from '../../app/lib/payroll/central-attendance-contract'
import type { BusinessSession } from './business-session'
import type { CommandJournal } from './command-journal'
import { createHash, randomUUID } from 'node:crypto'
import {
  CREW_WRITE_CAPABILITY,
  WORKER_WRITE_CAPABILITY,
} from '../../app/lib/crew-worker/command-contract'
import { CREW_PAYROLL_FEE_FIELDS, crewPayrollFeeValues, updatedCrewPayrollFeeValues } from '../../app/lib/crew-worker/payroll-fee-defaults'
import { crewWorkerProblem, CrewWorkerRepositoryProblem } from '../../app/lib/crew-worker/read-contract'
import { commandReplay, parseResolveCommandBody, resolveJournalCommand } from './command-journal'
import { assertRetainedMigrationReferences, migratedIdentityDraft, migratedIdentityRecords, migratedIdentityTimestamp } from './core-identity-migration'

export interface CrewWorkerStored<TDraft> {
  deletedAt?: string | null
  payrollFeeDefaults?: CrewPayrollFeeValues
  migrationBatchId?: string | null
  linkedWorkerId?: string | null
  id: string
  draft: TDraft
  version: number
  updatedAt: string
}

export interface CrewWorkerCommandState extends CommandJournal<CrewWorkerCommandResultDTO> {
  commands: Map<string, CrewWorkerCommandResultDTO>
  crews: Map<string, CrewWorkerStored<CrewFormDraft>>
  workers: Map<string, CrewWorkerStored<WorkerFormDraft>>
  sourceVersion: number
}

export interface CrewWorkerCommandOptions {
  initialState?: CrewWorkerCommandState
  createId?: (kind: 'crew' | 'worker') => string
  now?: () => string
  projectIds?: (sessionId?: string | null) => readonly string[]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function explicitRatio(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
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

function crewRow(stored: CrewWorkerStored<CrewFormDraft>): CrewSourceRow {
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
    defaultPayRatio: Number.isFinite(draft.defaultPayRatio) ? Number(draft.defaultPayRatio) : null,
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

function workerRow(stored: CrewWorkerStored<WorkerFormDraft>): WorkerSourceRow {
  const draft = stored.draft
  return {
    dataOrigin: 'real',
    id: stored.id,
    crewId: text(draft.crewId) || null,
    currentProjectId: text(draft.currentProjectId) || null,
    linkedWorkerId: stored.linkedWorkerId ?? null,
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

export function createCrewWorkerCommandService(options: CrewWorkerCommandOptions = {}) {
  const states = new Map<string, CrewWorkerCommandState>()
  const createId = options.createId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const projectIds = options.projectIds ?? (() => [])
  const keyFor = (sessionId?: string | null) => sessionId || 'default'
  const stateFor = (sessionId?: string | null) => {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = options.initialState ? structuredClone(options.initialState) : { commands: new Map(), commandFingerprints: new Map(), sealedCommands: new Set(), crews: new Map(), workers: new Map(), sourceVersion: 0 }
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
    input = structuredClone(input)
    const { key: commandKey, previous: duplicate } = commandReplay(state, input.request, input.session, input.kind, message => fail('conflict', message))
    if (duplicate)
      return { ...duplicate, attachmentIds: [] }
    const records = (input.kind === 'crew' ? state.crews : state.workers) as Map<string, CrewWorkerStored<TDraft>>
    const existing = input.request.id ? records.get(input.request.id) : null
    if (input.request.id && (!existing || existing.deletedAt))
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
      if (crewDraft.defaultPayRatio != null && (typeof crewDraft.defaultPayRatio !== 'number' || !Number.isFinite(crewDraft.defaultPayRatio) || crewDraft.defaultPayRatio < 0 || crewDraft.defaultPayRatio > 1))
        throw fail('validation-failed', '发放比例必须在 0 到 1 之间', { defaultPayRatio: ['发放比例必须在 0 到 1 之间'] })
      if ([...state.crews.values()].some(item => item.id !== input.request.id && text(item.draft.name) === text(crewDraft.name)))
        throw fail('validation-failed', '班组名称已存在', { name: ['班组名称已存在'] })
      crewDraft.status = lifecycle(input.request.action)
    }
    else {
      const workerDraft = draft as WorkerFormDraft
      if (workerDraft.dailyWage != null && (typeof workerDraft.dailyWage !== 'number' || !Number.isFinite(workerDraft.dailyWage) || workerDraft.dailyWage < 0))
        throw fail('validation-failed', '参考日工资必须是非负数值或空值', { dailyWage: ['参考日工资必须是非负数值或空值'] })
      if (workerDraft.crewId && (!state.crews.has(workerDraft.crewId) || state.crews.get(workerDraft.crewId)?.deletedAt))
        throw fail('validation-failed', '所属班组不存在或来源不匹配', { crewId: ['所属班组不存在或来源不匹配'] })
      if (workerDraft.currentProjectId && workerDraft.currentProjectId !== (existing?.draft as WorkerFormDraft | undefined)?.currentProjectId) {
        if (!input.session.capabilities.includes('project:list:read'))
          throw fail('forbidden', '无项目目录读取权限，不能改变工人的当前项目')
        if (!projectIds(input.sessionId).includes(workerDraft.currentProjectId))
          throw fail('validation-failed', '当前项目不存在或来源不匹配', { currentProjectId: ['必须选择同工作区真实项目'] })
      }
      workerDraft.status = lifecycle(input.request.action)
    }
    const id = existing?.id ?? createId(input.kind)
    const timestamp = now()
    const stored: CrewWorkerStored<TDraft> = { id, draft: { ...draft, id }, version: (existing?.version ?? 0) + 1, updatedAt: timestamp, migrationBatchId: existing?.migrationBatchId ?? null, ...(existing?.linkedWorkerId !== undefined ? { linkedWorkerId: existing.linkedWorkerId } : {}) }
    if (input.kind === 'crew') {
      try {
        stored.payrollFeeDefaults = updatedCrewPayrollFeeValues(draft, existing ? { draft: existing.draft, values: existing.payrollFeeDefaults ?? updatedCrewPayrollFeeValues(existing.draft) } : undefined)
      }
      catch (cause) { throw fail('validation-failed', cause instanceof Error ? cause.message : '班组费用默认无效') }
    }
    records.set(id, stored)
    state.sourceVersion += 1
    const result = { id, commandId: input.request.commandId, version: String(stored.version), updatedAt: timestamp, attachmentIds: [] }
    state.commands.set(commandKey, result)
    return { ...result, attachmentIds: [] }
  }

  return {
    snapshot(sessionId?: string | null): CrewWorkerCommandState { return structuredClone(stateFor(sessionId)) },
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[], sessionId?: string | null) {
      assertRetainedMigrationReferences(removed, 'workers', [...stateFor(sessionId).workers.values()].map(row => ({
        id: row.id,
        references: [{ type: 'crews', id: row.draft.crewId }, { type: 'projects', id: row.draft.currentProjectId }],
      })), message => fail('conflict', message))
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const current = stateFor(sessionId)
      const crews = migratedIdentityRecords(current.crews, snapshot, 'crews', (entity) => {
        const payrollFeeDefaults = crewPayrollFeeValues(entity.attributes)
        const displayed = Object.fromEntries(CREW_PAYROLL_FEE_FIELDS.map((field) => {
          const fact = payrollFeeDefaults[field.fact]
          return [field.attribute, fact.state === 'value' ? fact.value : field.kind === 'boolean' ? false : null]
        }))
        return { id: entity.id, draft: { ...migratedIdentityDraft<CrewFormDraft>('crew', entity), ...displayed, defaultPayRatio: explicitRatio(entity.attributes.defaultPayRatio) }, payrollFeeDefaults, version: 1, updatedAt: migratedIdentityTimestamp(entity) }
      })
      const workers = migratedIdentityRecords(current.workers, snapshot, 'workers', entity => ({ id: entity.id, draft: migratedIdentityDraft<WorkerFormDraft>('worker', entity), version: 1, updatedAt: migratedIdentityTimestamp(entity) }))
      const candidate = { ...current, crews, workers, sourceVersion: current.sourceVersion + (crews === current.crews && workers === current.workers ? 0 : 1) }
      return () => states.set(keyFor(sessionId), candidate)
    },
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    resolve(kind: 'crew' | 'worker', commandId: string, session: BusinessSession, sessionId?: string | null) {
      const capability = kind === 'crew' ? CREW_WRITE_CAPABILITY : WORKER_WRITE_CAPABILITY
      if (!session.capabilities.includes(capability))
        throw fail('forbidden', '无班组或工人原提交核对权限')
      parseResolveCommandBody({ commandId })
      return resolveJournalCommand(stateFor(sessionId), commandId, session, kind)
    },
    crewRows(sessionId?: string | null): CrewSourceRow[] {
      return [...stateFor(sessionId).crews.values()].filter(record => !record.deletedAt).map(crewRow)
    },
    /** 由工资 owner 授权后消费的原比例证据；缺省表单值不具备迁入来源资格。 */
    payrollRatioFacts(sessionId?: string | null) {
      const state = stateFor(sessionId)
      const rows = [...state.crews.values()].map((stored) => {
        const value = explicitRatio(stored.draft.defaultPayRatio)
        const sourceVersion = createHash('sha256').update(JSON.stringify([stored.id, stored.version, stored.updatedAt, value])).digest('hex')
        return { crewId: stored.id, value, explicitlyConfigured: value !== null, sourceVersion }
      })
      return { sourceVersion: `crew-payroll-ratio:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`, rows }
    },
    /** 工资 owner 授权后消费，版本只绑定费用事实；改名不等于采用旧显示默认。 */
    payrollCrewFeeDefaults(sessionId?: string | null) {
      const rows: PayrollCrewFeeDefaults[] = [...stateFor(sessionId).crews.values()].map((stored) => {
        const values = stored.payrollFeeDefaults ?? updatedCrewPayrollFeeValues(stored.draft)
        return { crewId: stored.id, ...values, sourceVersion: createHash('sha256').update(JSON.stringify([stored.id, values])).digest('hex') }
      })
      return { sourceVersion: `crew-payroll-fees:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`, rows }
    },
    /** 工资 owner 授权后读取；属性缺失、原 NULL 和明确零分别保留。 */
    payrollWorkerFacts(sessionId?: string | null) {
      const rows: PayrollWorkerFact[] = [...stateFor(sessionId).workers.values()].map((stored) => {
        const raw = stored.draft.dailyWage
        if (raw != null && (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0))
          throw fail('validation-failed', '工人原日薪无法确认，不能按缺价或零读取')
        const fact = {
          workerId: stored.id,
          crewId: text(stored.draft.crewId) || null,
          currentProjectId: text(stored.draft.currentProjectId) || null,
          dailyWage: raw ?? null,
          dailyWageState: !Object.hasOwn(stored.draft, 'dailyWage') || raw === undefined ? 'missing' as const : raw === null ? 'null' as const : 'value' as const,
        }
        return { ...fact, sourceVersion: createHash('sha256').update(JSON.stringify(fact)).digest('hex') }
      })
      return { sourceVersion: `worker-payroll:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`, rows }
    },
    workerRows(sessionId?: string | null): WorkerSourceRow[] {
      return [...stateFor(sessionId).workers.values()].filter(record => !record.deletedAt).map(workerRow)
    },
    sourceVersion(sessionId?: string | null): string {
      return `crew-worker-command-${stateFor(sessionId).sourceVersion}`
    },
    crewForm(id: string, session: BusinessSession, sessionId?: string | null): CrewFormReadDTO {
      if (!session.capabilities.includes(CREW_WRITE_CAPABILITY))
        throw fail('forbidden', '无班组写入权限')
      const stored = stateFor(sessionId).crews.get(id)
      if (!stored || stored.deletedAt)
        throw fail('not-found', '正式班组不存在')
      return { draft: { ...stored.draft, id }, attachments: [], version: String(stored.version), updatedAt: stored.updatedAt }
    },
    workerForm(id: string, session: BusinessSession, sessionId?: string | null): WorkerFormReadDTO {
      if (!session.capabilities.includes(WORKER_WRITE_CAPABILITY))
        throw fail('forbidden', '无工人写入权限')
      if (!session.capabilities.includes('worker:sensitive:read'))
        throw fail('forbidden', '工人完整编辑表单包含身份证和银行资料，需要工人私密资料读取权限')
      const stored = stateFor(sessionId).workers.get(id)
      if (!stored || stored.deletedAt)
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
