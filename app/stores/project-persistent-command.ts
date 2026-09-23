import type {
  FormAttachment,
  FormAttachmentChanges,
  MasterDataSaveAction,
  ProjectFormDraft,
} from '~/lib/master-data/forms'
import type { ProjectFormReadDTO } from '~/lib/project/command-contract'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { PROJECT_WRITE_CAPABILITY } from '~/lib/project/command-contract'
import { clearProjectPending, projectPendingKey, readProjectPending, rememberProjectPending } from '~/lib/project/pending'
import { projectProblemFromUnknown } from '~/lib/project/repository'

export interface HydratedPersistentProjectForm {
  draft: ProjectFormDraft | null
  attachments: FormAttachment[]
  pendingAttachments: NonNullable<FormAttachmentChanges['add']>
  pendingRemoveIds: string[]
  pendingRestoreIds: string[]
  restoredLocalDraft: null
  productionNotice: string
}

export class ProjectPersistentConflictError extends Error {
  constructor(public readonly latest: ProjectFormReadDTO, public readonly alreadyApplied = false) {
    super(alreadyApplied ? '上次提交已经保存，请先读取已保存内容；当前未保存输入仍在页面。' : '项目已有更新版本，请选择如何处理')
    this.name = 'ProjectPersistentConflictError'
  }
}

export const useProjectPersistentCommandStore = defineStore('project-persistent-command', () => {
  function createSession() {
    return { targetProjectId: null as string | null, baseVersion: null as string | null, pendingCommand: null as { id: string, fingerprint: string } | null, storesOriginals: false, pendingKey: '', resolvedPending: null as { key: string, commandId: string } | null }
  }
  type CommandSession = ReturnType<typeof createSession>

  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const repository = () => useNuxtApp().$repositories.projectCommands

  async function hydrate(session: CommandSession, id: string | null): Promise<HydratedPersistentProjectForm> {
    const context = await repository().context()
    session.storesOriginals = context.capabilities.includes('project:original:write')
    session.pendingKey = session.storesOriginals ? projectPendingKey(context, `form:${id ?? 'new'}`) : ''
    let productionNotice = ''
    let recoveredCommand: string | null = null
    if (session.pendingKey) {
      const commandId = readProjectPending(session.pendingKey)
      if (commandId) {
        const resolved = await useNuxtApp().$repositories.projectProduction.resolve(commandId)
        if (resolved.result) {
          id = resolved.result.id
          productionNotice = '已核对上次提交：保存成功，现已读取磁盘中的项目。'
        }
        else {
          productionNotice = '已核对上次提交：没有保存，迟到请求已封存。刷新前未保存的输入和附件需重新选择。'
        }
        recoveredCommand = commandId
      }
    }
    session.targetProjectId = id
    session.pendingCommand = null
    const form = id ? await repository().loadForm(id) : null
    if (recoveredCommand)
      clearProjectPending(session.pendingKey, recoveredCommand)
    session.resolvedPending = null
    session.baseVersion = form?.version ?? null
    return {
      draft: form?.draft ?? null,
      attachments: form?.attachments ?? [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
      productionNotice,
    }
  }

  function startNewProject(session: CommandSession) {
    session.resolvedPending = null
    session.targetProjectId = null
    session.baseVersion = null
    session.pendingCommand = null
  }

  function rebase(session: CommandSession, version: string) {
    session.baseVersion = version
  }

  function acceptLatest(session: CommandSession, latest: ProjectFormReadDTO) {
    if (session.resolvedPending) {
      clearProjectPending(session.resolvedPending.key, session.resolvedPending.commandId)
      session.resolvedPending = null
    }
    session.targetProjectId = latest.draft.id
    session.baseVersion = latest.version
  }

  async function saveForm(session: CommandSession, draft: ProjectFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    const id = session.targetProjectId ?? draft.id ?? null
    const context = await repository().context()
    const persistent = context.capabilities.includes('project:original:write')
    const pendingKey = persistent ? projectPendingKey(context, `form:${draft.id ?? 'new'}`) : ''
    if (pendingKey) {
      const prior = readProjectPending(pendingKey)
      if (prior) {
        const resolved = await useNuxtApp().$repositories.projectProduction.resolve(prior)
        if (resolved.result) {
          const latest = await repository().loadForm(resolved.result.id)
          session.resolvedPending = { key: pendingKey, commandId: prior }
          session.targetProjectId = resolved.result.id
          session.pendingCommand = null
          throw new ProjectPersistentConflictError(latest, true)
        }
        clearProjectPending(pendingKey, prior)
        session.pendingCommand = null
      }
    }
    const content = {
      id,
      baseVersion: session.baseVersion,
      action,
      draft: { ...draft, ...(id ? { id } : {}) },
      attachments,
    }
    const fingerprint = JSON.stringify(content)
    if (!session.pendingCommand || session.pendingCommand.fingerprint !== fingerprint) {
      session.pendingCommand = {
        id: crypto.randomUUID(),
        fingerprint,
      }
    }
    try {
      if (pendingKey)
        rememberProjectPending(pendingKey, session.pendingCommand.id)
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        requiredCapability: PROJECT_WRITE_CAPABILITY,
        commandId: session.pendingCommand.id,
        baseVersion: session.baseVersion,
        action,
        draft: content.draft,
        attachments,
      })
      if (result.commandId !== session.pendingCommand.id)
        throw new Error('项目回执编号与原提交不一致，请核对原提交')
      if (pendingKey)
        clearProjectPending(pendingKey, session.pendingCommand.id)
      session.pendingCommand = null
      session.targetProjectId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { id: result.id, logId: null, attachmentIds: result.attachmentIds }
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id)
        throw new ProjectPersistentConflictError(await repository().loadForm(id))
      throw problem
    }
  }

  function downloadOriginal(projectId: string, fileId: string) {
    return useNuxtApp().$repositories.projectProduction.file(projectId, fileId)
  }

  async function pendingForms() {
    const context = await repository().context()
    if (!context.capabilities.includes('project:original:write'))
      return []
    const prefix = projectPendingKey(context, 'form:')
    const paths: string[] = []
    for (let index = 0; index < window.sessionStorage.length; index++) {
      const key = window.sessionStorage.key(index)
      if (!key?.startsWith(prefix) || !readProjectPending(key))
        continue
      const target = decodeURIComponent(key.slice(prefix.length))
      if (target === 'new')
        paths.push('/project/form')
      else if (/^[a-z0-9][\w-]{2,79}$/i.test(target))
        paths.push(`/project/form/${encodeURIComponent(target)}?origin=real`)
    }
    return paths
  }

  return {
    latestWrite: readonly(latestWrite),
    createSession,
    hydrate,
    saveForm,
    startNewProject,
    rebase,
    acceptLatest,
    downloadOriginal,
    pendingForms,
  }
})
