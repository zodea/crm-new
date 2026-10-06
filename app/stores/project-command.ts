import type {
  FormAttachment,
  FormAttachmentChanges,
  MasterDataSaveAction,
  ProjectFormDraft,
} from '~/lib/master-data/forms'
import type { ProjectFormReadDTO } from '~/lib/project/command-contract'
import type { ProjectLocalDraft } from '~/lib/project/local-draft'
import { defineStore } from 'pinia'
import { readonly, shallowReactive, shallowRef } from 'vue'
import { PROJECT_WRITE_CAPABILITY } from '~/lib/project/command-contract'
import { createProjectRowImporter } from '~/lib/project/import-command'
import {
  clearProjectLocalDraft,
  loadProjectLocalDraft,
  saveProjectLocalDraft,
} from '~/lib/project/local-draft'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { useProductionAccessStore } from '~/stores/production-access'
import { useProjectPersistentCommandStore } from '~/stores/project-persistent-command'

export interface HydratedProjectCommandForm {
  draft: ProjectFormDraft | null
  attachments: FormAttachment[]
  pendingAttachments: NonNullable<FormAttachmentChanges['add']>
  pendingRemoveIds: string[]
  pendingRestoreIds: string[]
  restoredLocalDraft: ProjectLocalDraft | null
  productionNotice?: string
}

export class ProjectCommandConflictError extends Error {
  constructor(
    public readonly latest: ProjectFormReadDTO,
    public readonly localDraft: ProjectLocalDraft,
  ) {
    super('项目已有更新版本，请选择如何处理')
    this.name = 'ProjectCommandConflictError'
  }
}

export class ProjectLocalDraftOnlyError extends Error {
  constructor(public readonly localDraft: ProjectLocalDraft) {
    super('中央后台暂时不可用；已仅保留本地草稿，未正式保存')
    this.name = 'ProjectLocalDraftOnlyError'
  }
}

export const useProjectCommandStore = defineStore('project-command', () => {
  const persistent = useProjectPersistentCommandStore()
  const access = useProductionAccessStore()
  function createSession() {
    return shallowReactive({ targetProjectId: null as string | null, baseVersion: null as string | null, activeLocalDraft: null as ProjectLocalDraft | null, storesOriginals: false, loadGeneration: 0, authority: null as { workspaceId: string, actorId: string } | null, persistent: persistent.createSession() })
  }
  type CommandSession = ReturnType<typeof createSession>

  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)

  function repository() {
    return useNuxtApp().$repositories.projectCommands
  }

  let rowImporter: ReturnType<typeof createProjectRowImporter> | undefined
  function importer() {
    return rowImporter ??= createProjectRowImporter(repository(), useNuxtApp().$repositories.customerRead)
  }
  async function prepareImportRow(row: Record<string, unknown>) {
    return importer().prepare(row)
  }
  async function validateImportRow(row: Record<string, unknown>) {
    return importer().validate(row)
  }
  async function importRow(row: Record<string, unknown>) {
    const saved = await importer().importRow(row)
    latestWrite.value = { id: saved.id, version: saved.version }
    return saved
  }

  function deactivate(session: CommandSession) {
    session.loadGeneration++
    persistent.deactivate(session.persistent)
  }
  async function revalidate(session: CommandSession) {
    if (session.storesOriginals)
      return persistent.revalidate(session.persistent)
    const generation = session.loadGeneration
    const target = session.targetProjectId
    const context = await repository().context()
    const current = () => generation === session.loadGeneration && target === session.targetProjectId && !session.storesOriginals
    if (!current() || !context.capabilities.includes(PROJECT_WRITE_CAPABILITY) || context.capabilities.includes('project:original:write')
      || (session.authority && (context.workspaceId !== session.authority.workspaceId || context.actorId !== session.authority.actorId))) {
      throw new Error('原项目表单权限或来源已变化，请保留输入。')
    }
    const form = target ? await repository().loadForm(target) : null
    if (!current() || (form && form.draft.id !== target))
      throw new Error('重新读取与原项目目标不一致。')
    session.authority = { workspaceId: context.workspaceId, actorId: context.actorId }
    return { form, context }
  }
  async function hydrate(session: CommandSession, id: string | null): Promise<HydratedProjectCommandForm> {
    const generation = ++session.loadGeneration
    const assertCurrent = () => {
      if (generation !== session.loadGeneration)
        throw new Error('此读取不属于当前项目页面。')
    }
    session.storesOriginals = access.status?.mode === 'production'
    if (session.storesOriginals)
      return persistent.hydrate(session.persistent, id)
    session.targetProjectId = id
    const local = loadProjectLocalDraft(id)
    session.activeLocalDraft = local
    let latest: ProjectFormReadDTO | null = null
    try {
      latest = id ? await repository().loadForm(id) : null
      assertCurrent()
    }
    catch (cause) {
      assertCurrent()
      const problem = projectProblemFromUnknown(cause)
      if (!local || problem.problem.code !== 'unavailable')
        throw problem
      session.baseVersion = local.baseVersion
      return {
        draft: local.draft,
        attachments: [],
        pendingAttachments: local.attachments.add ?? [],
        pendingRemoveIds: local.attachments.removeIds ?? [],
        pendingRestoreIds: local.attachments.restoreIds ?? [],
        restoredLocalDraft: local,
      }
    }
    session.baseVersion = latest?.version ?? null
    if (local)
      session.baseVersion = local.baseVersion
    return {
      draft: local?.draft ?? latest?.draft ?? null,
      attachments: latest?.attachments ?? [],
      pendingAttachments: local?.attachments.add ?? [],
      pendingRemoveIds: local?.attachments.removeIds ?? [],
      pendingRestoreIds: local?.attachments.restoreIds ?? [],
      restoredLocalDraft: local,
    }
  }

  function startNewProject(session: CommandSession): void {
    if (session.storesOriginals) {
      persistent.startNewProject(session.persistent)
      return
    }
    if (session.activeLocalDraft)
      clearProjectLocalDraft(session.activeLocalDraft.draftId)
    session.loadGeneration++
    session.targetProjectId = null
    session.baseVersion = null
    session.activeLocalDraft = null
  }

  function rebase(session: CommandSession, version: string): void {
    if (session.storesOriginals) {
      persistent.rebase(session.persistent, version)
      return
    }
    session.baseVersion = version
    if (session.activeLocalDraft) {
      session.activeLocalDraft = saveProjectLocalDraft({
        ...session.activeLocalDraft,
        baseVersion: version,
        targetProjectId: session.targetProjectId,
      })
    }
  }

  function acceptLatest(session: CommandSession, latest: ProjectFormReadDTO): void {
    if (session.storesOriginals) {
      persistent.acceptLatest(session.persistent, latest)
      return
    }
    if (session.activeLocalDraft)
      clearProjectLocalDraft(session.activeLocalDraft.draftId)
    session.activeLocalDraft = null
    session.baseVersion = latest.version
  }

  async function saveForm(session: CommandSession, draft: ProjectFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    if (access.status?.mode === 'production' && !session.storesOriginals)
      throw new Error('请先重新读取正式项目表单，再保存资料。')
    if (session.storesOriginals) {
      const result = await persistent.saveForm(session.persistent, draft, action, attachments)
      latestWrite.value = { id: result.id, version: session.persistent.baseVersion! }
      return result
    }
    const generation = session.loadGeneration
    const assertCurrent = () => {
      if (generation !== session.loadGeneration || session.storesOriginals)
        throw new Error('原项目页面已变化，请保留原草稿并回原页面核对。')
    }
    const id = session.targetProjectId ?? draft.id ?? null
    const local = saveProjectLocalDraft({
      targetProjectId: id,
      commandId: session.activeLocalDraft?.commandId ?? crypto.randomUUID(),
      baseVersion: session.baseVersion,
      action,
      draft: { ...draft, ...(id ? { id } : {}) },
      attachments,
    })
    session.activeLocalDraft = local
    try {
      const context = await repository().context()
      assertCurrent()
      if (!context.capabilities.includes(PROJECT_WRITE_CAPABILITY) || context.capabilities.includes('project:original:write')
        || (session.authority && (context.workspaceId !== session.authority.workspaceId || context.actorId !== session.authority.actorId))) {
        throw new Error('原项目表单权限或来源已变化，请保留原草稿。')
      }
      session.authority = { workspaceId: context.workspaceId, actorId: context.actorId }
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        requiredCapability: PROJECT_WRITE_CAPABILITY,
        commandId: local.commandId,
        baseVersion: local.baseVersion,
        action: local.action,
        draft: local.draft,
        attachments: local.attachments,
      })
      assertCurrent()
      clearProjectLocalDraft(local.draftId)
      session.activeLocalDraft = null
      session.targetProjectId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return {
        id: result.id,
        logId: null,
        attachmentIds: result.attachmentIds,
      }
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id) {
        const latest = await repository().loadForm(id)
        assertCurrent()
        throw new ProjectCommandConflictError(latest, local)
      }
      if (problem.problem.code === 'unavailable')
        throw new ProjectLocalDraftOnlyError(local)
      throw problem
    }
  }

  return {
    recordLifecycleWrite(current: { id: string, version: string }) {
      latestWrite.value = { id: current.id, version: current.version }
    },
    pendingForms: persistent.pendingForms,
    async recover(session: CommandSession) {
      const recovered = await persistent.recover(session.persistent)
      if (recovered.outcome === 'applied')
        latestWrite.value = { id: recovered.result.id, version: recovered.result.version }
      return recovered
    },
    downloadOriginal: persistent.downloadOriginal,
    prepareImportRow,
    validateImportRow,
    importRow,
    latestWrite: readonly(latestWrite),
    createSession,
    hydrate,
    revalidate,
    deactivate,
    saveForm,
    startNewProject,
    rebase,
    acceptLatest,
  }
})
