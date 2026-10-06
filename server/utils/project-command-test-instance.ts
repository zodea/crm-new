import type {
  FormAttachment,
  FormAttachmentChanges,
  FormAttachmentDraft,
  ProjectFormDraft,
} from '../../app/lib/master-data/forms'
import type { CoreMigrationServerEntityDTO, CoreMigrationSnapshotDTO } from '../../app/lib/migration/core-contract'
import type {
  ProjectCommandRequestDTO,
  ProjectCommandResultDTO,
  ProjectFormReadDTO,
} from '../../app/lib/project/command-contract'
import type { ProjectImportSource } from '../../app/lib/project/import'
import type { ProjectListSourceRow } from '../../app/lib/project/repository'
import type { BusinessSession } from './business-session'
import type { CommandJournal } from './command-journal'
import { randomUUID } from 'node:crypto'
import {
  PROJECT_WRITE_CAPABILITY,
} from '../../app/lib/project/command-contract'
import { decodeProjectImportSource, matchesProjectImportSource } from '../../app/lib/project/import'
import {
  projectProblem,
  ProjectRepositoryProblem,
} from '../../app/lib/project/repository'
import { assertCommandUnsealed, commandReplay, parseResolveCommandBody, resolveJournalCommand } from './command-journal'
import { assertRetainedMigrationReferences, migratedIdentityDraft, migratedIdentityRecords, migratedIdentityTimestamp } from './core-identity-migration'
import {
  assertProjectCommandBusinessRules,
  decodeProjectCommandContent,
  deriveProjectApprovalStatus,
} from './project-command-domain'

interface StoredProject {
  migrationBatchId?: string | null
  id: string
  draft: ProjectFormDraft
  attachments: FormAttachment[]
  version: number
  updatedAt: string
  importSource?: ProjectImportSource
  importSignature?: string
  importResult?: ProjectCommandResultDTO
}

interface SessionState extends CommandJournal<ProjectCommandResultDTO> {
  commands: Map<string, ProjectCommandResultDTO>
  projects: Map<string, StoredProject>
  sourceVersion: number
}

interface ProjectCommandTestInstanceOptions {
  createId?: () => string
  now?: () => string
  validateImportCustomers?: (draft: ProjectFormDraft, session: BusinessSession, sessionId?: string | null) => Promise<void>
}

export interface ProjectImportAdoptionTransaction {
  commit: () => void
  rollback: () => void
}

function forbidden(message: string): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem(projectProblem('forbidden', message))
}

function invalid(message: string, fieldErrors: Record<string, string[]> = {}): ProjectRepositoryProblem {
  return new ProjectRepositoryProblem({
    ...projectProblem('validation-failed', message),
    fieldErrors,
  })
}

function requiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function attachmentFromDraft(
  projectId: string,
  draft: FormAttachmentDraft,
  now: string,
): FormAttachment {
  return {
    id: `file-${randomUUID()}`,
    ownerType: 'project',
    ownerId: projectId,
    fileName: draft.fileName.trim(),
    filePath: draft.filePath?.trim() ?? '',
    fileSize: Math.max(0, draft.fileSize ?? 0),
    mimeType: draft.mimeType?.trim() ?? '',
    category: draft.category?.trim() ?? '',
    uploader: draft.uploader?.trim() ?? '',
    uploadedAt: now,
    deletedAt: null,
  }
}

function applyAttachments(
  projectId: string,
  current: readonly FormAttachment[],
  changes: FormAttachmentChanges,
  now: string,
): FormAttachment[] {
  const removed = new Set(changes.removeIds ?? [])
  const restored = new Set(changes.restoreIds ?? [])
  const existing = current.map(attachment => ({
    ...attachment,
    deletedAt: removed.has(attachment.id)
      ? now
      : restored.has(attachment.id) ? null : attachment.deletedAt,
  }))
  return [
    ...existing,
    ...(changes.add ?? []).map(draft => attachmentFromDraft(projectId, draft, now)),
  ]
}

function toSourceRow(project: StoredProject): ProjectListSourceRow {
  const draft = project.draft
  return {
    dataOrigin: 'real',
    id: project.id,
    name: draft.name?.trim() ?? '',
    code: draft.code?.trim() ?? '',
    status: draft.status?.trim() || '筹备中',
    contractAmount: draft.contractAmount ?? null,
    operationType: draft.operationType?.trim() ?? '',
    startDate: draft.startDate?.trim() || null,
    plannedEnd: draft.plannedEnd?.trim() || null,
    actualEnd: draft.actualEnd?.trim() || null,
    plannedDuration: draft.plannedDuration ?? null,
    manager: draft.manager?.trim() ?? '',
    execManager: draft.execManager?.trim() ?? '',
    builder: draft.builder?.trim() ?? '',
    customerId: draft.customerId?.trim() || null,
    customerName: null,
    customerPermission: 'allowed',
    secondaryCustomerId: draft.secondaryCustomerId?.trim() || null,
    secondaryCustomerName: null,
    secondaryCustomerPermission: 'allowed',
    contractName: draft.contractName?.trim() ?? '',
    contractor: draft.contractor?.trim() ?? '',
    region: draft.region?.trim() ?? '',
    riskLevel: draft.riskLevel?.trim() ?? '',
    address: draft.address?.trim() ?? '',
    income: null,
    budget: null,
    updatedAt: project.updatedAt,
  }
}

function importedStoredProject(row: ProjectListSourceRow): StoredProject {
  return {
    id: row.id,
    draft: {
      id: row.id,
      name: row.name,
      code: row.code,
      status: row.status,
      contractAmount: row.contractAmount,
      operationType: row.operationType,
      startDate: row.startDate ?? '',
      plannedEnd: row.plannedEnd ?? '',
      actualEnd: row.actualEnd ?? '',
      plannedDuration: row.plannedDuration,
      manager: row.manager,
      execManager: row.execManager,
      builder: row.builder,
      customerId: row.customerId,
      secondaryCustomerId: row.secondaryCustomerId,
      contractName: row.contractName,
      contractor: row.contractor,
      region: row.region,
      riskLevel: row.riskLevel,
      address: row.address,
      approvalStatus: 'draft',
    },
    attachments: [],
    version: 1,
    updatedAt: row.updatedAt,
  }
}

function cloneState(state: SessionState): SessionState {
  return {
    commands: new Map(state.commands),
    commandFingerprints: new Map(state.commandFingerprints),
    sealedCommands: new Set(state.sealedCommands),
    projects: new Map([...state.projects].map(([id, project]) => [id, {
      ...project,
      draft: { ...project.draft },
      attachments: project.attachments.map(attachment => ({ ...attachment })),
    }])),
    sourceVersion: state.sourceVersion,
  }
}

export function createProjectCommandTestInstance(
  options: ProjectCommandTestInstanceOptions = {},
) {
  const states = new Map<string, SessionState>()
  const createId = options.createId ?? (() => randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const keyFor = (sessionId?: string | null) => sessionId || 'default'

  function stateFor(sessionId?: string | null): SessionState {
    const key = keyFor(sessionId)
    let state = states.get(key)
    if (!state) {
      state = { commands: new Map(), commandFingerprints: new Map(), sealedCommands: new Set(), projects: new Map(), sourceVersion: 0 }
      states.set(key, state)
    }
    return state
  }

  function validateEnvelope(request: ProjectCommandRequestDTO, session: BusinessSession): void {
    if (request.workspaceId !== session.workspaceId)
      throw forbidden('请求工作区与当前会话不匹配')
    if (request.actorId !== session.actorId)
      throw forbidden('请求操作人与当前会话不匹配')
    if (request.requiredCapability !== PROJECT_WRITE_CAPABILITY
      || !session.capabilities.includes(PROJECT_WRITE_CAPABILITY)) {
      throw forbidden('无项目写入权限')
    }
    if (!requiredText(request.commandId))
      throw invalid('commandId 必填', { commandId: ['commandId 必填'] })
  }

  return {
    assertMigrationRemoval(removed: readonly CoreMigrationServerEntityDTO[], sessionId?: string | null) {
      assertRetainedMigrationReferences(removed, 'projects', [...stateFor(sessionId).projects.values()].map(row => ({
        id: row.id,
        references: [{ type: 'customers', id: row.draft.customerId }, { type: 'customers', id: row.draft.secondaryCustomerId }],
      })), message => new ProjectRepositoryProblem(projectProblem('conflict', message)))
    },
    prepareMigrationSnapshot(snapshot: CoreMigrationSnapshotDTO, sessionId?: string | null) {
      const current = stateFor(sessionId)
      const records = migratedIdentityRecords(current.projects, snapshot, 'projects', entity => ({
        id: entity.id,
        draft: migratedIdentityDraft<ProjectFormDraft>('project', entity),
        attachments: [],
        version: 1,
        updatedAt: migratedIdentityTimestamp(entity),
      }))
      const candidate = { ...current, projects: records, sourceVersion: current.sourceVersion + (records === current.projects ? 0 : 1) }
      return () => states.set(keyFor(sessionId), candidate)
    },
    reset(sessionId?: string | null) {
      states.delete(keyFor(sessionId))
    },
    prepareImportedProjects(rows: readonly ProjectListSourceRow[], sessionId?: string | null): ProjectImportAdoptionTransaction {
      const key = keyFor(sessionId)
      const previous = states.get(key)
      const snapshot = previous ? cloneState(previous) : null
      let committed = false
      return {
        commit() {
          committed = true
          const state = stateFor(sessionId)
          let changed = false
          for (const row of rows) {
            if (state.projects.has(row.id))
              continue
            state.projects.set(row.id, importedStoredProject(row))
            changed = true
          }
          if (changed)
            state.sourceVersion += 1
        },
        rollback() {
          if (!committed)
            return
          if (snapshot)
            states.set(key, cloneState(snapshot))
          else
            states.delete(key)
          committed = false
        },
      }
    },
    rows(sessionId?: string | null): ProjectListSourceRow[] {
      return [...stateFor(sessionId).projects.values()].map(toSourceRow)
    },
    sourceVersion(sessionId?: string | null): string {
      return `project-command-${stateFor(sessionId).sourceVersion}`
    },
    form(
      id: string,
      session: BusinessSession,
      sessionId?: string | null,
    ): ProjectFormReadDTO {
      if (!session.capabilities.includes(PROJECT_WRITE_CAPABILITY))
        throw forbidden('无项目写入权限')
      const project = stateFor(sessionId).projects.get(id)
      if (!project) {
        throw new ProjectRepositoryProblem(projectProblem(
          'not-found',
          '正式项目不存在',
        ))
      }
      return {
        draft: { ...project.draft, id: project.id },
        ...(project.importSource ? { importSource: structuredClone(project.importSource) } : {}),
        attachments: project.attachments.map(attachment => ({ ...attachment })),
        version: String(project.version),
        updatedAt: project.updatedAt,
      }
    },
    async execute(
      request: ProjectCommandRequestDTO,
      session: BusinessSession,
      sessionId?: string | null,
    ): Promise<ProjectCommandResultDTO> {
      request = structuredClone(request)
      validateEnvelope(request, session)
      let state = stateFor(sessionId)
      const reject = (message: string) => new ProjectRepositoryProblem(projectProblem('conflict', message))
      const { key: commandKey, previous: duplicate } = commandReplay(state, request, session, 'project', reject)
      if (duplicate)
        return duplicate
      let importSource: ProjectImportSource | undefined
      if (request.importSource) {
        try {
          importSource = decodeProjectImportSource(request.importSource)
        }
        catch (cause) { throw invalid(cause instanceof Error ? cause.message : '项目导入来源无效') }
        if (request.id || request.action !== 'save' || request.baseVersion !== null)
          throw invalid('项目导入只能新建并保存，修改已有项目请进入编辑页')
      }
      const signature = JSON.stringify(Object.entries(request.draft).sort(([a], [b]) => a.localeCompare(b)))
      const findImported = () => importSource ? [...state.projects.values()].find(project => matchesProjectImportSource(project.importSource, importSource!)) : undefined
      const imported = findImported()
      if (imported) {
        if (imported.importSignature !== signature)
          throw new ProjectRepositoryProblem(projectProblem('conflict', `来源行或外部旧 ID 已导入项目 ${imported.id}，内容不同；请进入项目编辑页修改`))
        const result = { ...imported.importResult!, commandId: request.commandId, attachmentIds: [...imported.importResult!.attachmentIds] }
        state.commands.set(commandKey, structuredClone(result))
        return result
      }
      const content = decodeProjectCommandContent(request.draft, request.attachments)
      assertProjectCommandBusinessRules(content.draft, request.action)
      if (importSource) {
        if (options.validateImportCustomers)
          await options.validateImportCustomers(content.draft, session, sessionId)
        else
          await (await import('./project-import-customers')).assertProjectImportCustomers(content.draft, session, sessionId)
        state = stateFor(sessionId)
        validateEnvelope(request, session)
        assertCommandUnsealed(state, commandKey, reject)
        // 关系重验期间可能有另一份相同命令完成；重新进入同步去重/提交段。
        if (state.commands.has(commandKey) || findImported()) {
          return this.execute(request, session, sessionId)
        }
      }

      const existing = request.id ? state.projects.get(request.id) : null
      if (request.id && !existing) {
        throw new ProjectRepositoryProblem(projectProblem('not-found', '正式项目不存在'))
      }
      if (!request.id && request.baseVersion !== null)
        throw invalid('新建项目不能带 baseVersion')
      if (existing && request.baseVersion !== String(existing.version)) {
        throw new ProjectRepositoryProblem(projectProblem(
          'conflict',
          '项目已被其他操作更新，请先处理最新版本',
        ))
      }

      const timestamp = now()
      const id = existing?.id ?? createId()
      const version = (existing?.version ?? 0) + 1
      const project: StoredProject = {
        id,
        draft: {
          ...content.draft,
          id,
          approvalStatus: deriveProjectApprovalStatus(
            request.action,
            existing?.draft.approvalStatus,
          ),
        },
        attachments: applyAttachments(id, existing?.attachments ?? [], content.attachments, timestamp),
        version,
        updatedAt: timestamp,
        ...(existing?.importSource ? { importSource: existing.importSource, importSignature: existing.importSignature, importResult: existing.importResult } : {}),
        ...(importSource ? { importSource: structuredClone(importSource), importSignature: signature } : {}),
        migrationBatchId: existing?.migrationBatchId ?? null,
      }
      assertCommandUnsealed(state, commandKey, reject)
      state.projects.set(id, project)
      state.sourceVersion += 1
      const result: ProjectCommandResultDTO = {
        id,
        commandId: request.commandId,
        version: String(version),
        updatedAt: timestamp,
        attachmentIds: project.attachments
          .filter(attachment => !attachment.deletedAt)
          .map(attachment => attachment.id),
      }
      state.commands.set(commandKey, structuredClone(result))
      if (importSource)
        project.importResult = result
      return { ...result, attachmentIds: [...result.attachmentIds] }
    },
    resolve(commandId: string, session: BusinessSession, sessionId?: string | null) {
      if (!session.capabilities.includes(PROJECT_WRITE_CAPABILITY))
        throw forbidden('无项目原提交核对权限')
      if (!(commandId.startsWith('project-excel:') && commandId.length <= 4096))
        parseResolveCommandBody({ commandId })
      return resolveJournalCommand(stateFor(sessionId), commandId, session, 'project')
    },
  }
}

export const projectCommandTestInstance = createProjectCommandTestInstance()
