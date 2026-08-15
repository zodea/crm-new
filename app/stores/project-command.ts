import type {
  FormAttachment,
  FormAttachmentChanges,
  MasterDataSaveAction,
  ProjectFormDraft,
} from '~/lib/master-data/forms'
import type { ProjectFormReadDTO } from '~/lib/project/command-contract'
import type { ProjectLocalDraft } from '~/lib/project/local-draft'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { PROJECT_WRITE_CAPABILITY } from '~/lib/project/command-contract'
import {
  clearProjectLocalDraft,
  loadProjectLocalDraft,
  saveProjectLocalDraft,
} from '~/lib/project/local-draft'
import { projectProblemFromUnknown } from '~/lib/project/repository'

export interface HydratedProjectCommandForm {
  draft: ProjectFormDraft | null
  attachments: FormAttachment[]
  pendingAttachments: NonNullable<FormAttachmentChanges['add']>
  pendingRemoveIds: string[]
  pendingRestoreIds: string[]
  restoredLocalDraft: ProjectLocalDraft | null
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
  const targetProjectId = shallowRef<string | null>(null)
  const baseVersion = shallowRef<string | null>(null)
  const activeLocalDraft = shallowRef<ProjectLocalDraft | null>(null)
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)

  function repository() {
    return useNuxtApp().$repositories.projectCommands
  }

  async function hydrate(id: string | null): Promise<HydratedProjectCommandForm> {
    targetProjectId.value = id
    const local = loadProjectLocalDraft(id)
    activeLocalDraft.value = local
    let latest: ProjectFormReadDTO | null = null
    try {
      latest = id ? await repository().loadForm(id) : null
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause)
      if (!local || problem.problem.code !== 'unavailable')
        throw problem
      baseVersion.value = local.baseVersion
      return {
        draft: local.draft,
        attachments: [],
        pendingAttachments: local.attachments.add ?? [],
        pendingRemoveIds: local.attachments.removeIds ?? [],
        pendingRestoreIds: local.attachments.restoreIds ?? [],
        restoredLocalDraft: local,
      }
    }
    baseVersion.value = latest?.version ?? null
    if (local)
      baseVersion.value = local.baseVersion
    return {
      draft: local?.draft ?? latest?.draft ?? null,
      attachments: latest?.attachments ?? [],
      pendingAttachments: local?.attachments.add ?? [],
      pendingRemoveIds: local?.attachments.removeIds ?? [],
      pendingRestoreIds: local?.attachments.restoreIds ?? [],
      restoredLocalDraft: local,
    }
  }

  function startNewProject(): void {
    if (activeLocalDraft.value)
      clearProjectLocalDraft(activeLocalDraft.value.draftId)
    targetProjectId.value = null
    baseVersion.value = null
    activeLocalDraft.value = null
  }

  function rebase(version: string): void {
    baseVersion.value = version
    if (activeLocalDraft.value) {
      activeLocalDraft.value = saveProjectLocalDraft({
        ...activeLocalDraft.value,
        baseVersion: version,
        targetProjectId: targetProjectId.value,
      })
    }
  }

  function acceptLatest(latest: ProjectFormReadDTO): void {
    if (activeLocalDraft.value)
      clearProjectLocalDraft(activeLocalDraft.value.draftId)
    activeLocalDraft.value = null
    baseVersion.value = latest.version
  }

  async function saveForm(
    draft: ProjectFormDraft,
    action: MasterDataSaveAction,
    attachments: FormAttachmentChanges = {},
  ) {
    const id = targetProjectId.value ?? draft.id ?? null
    const local = saveProjectLocalDraft({
      targetProjectId: id,
      commandId: activeLocalDraft.value?.commandId ?? crypto.randomUUID(),
      baseVersion: baseVersion.value,
      action,
      draft: { ...draft, ...(id ? { id } : {}) },
      attachments,
    })
    activeLocalDraft.value = local
    try {
      const context = await repository().context()
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
      clearProjectLocalDraft(local.draftId)
      activeLocalDraft.value = null
      targetProjectId.value = result.id
      baseVersion.value = result.version
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
        throw new ProjectCommandConflictError(latest, local)
      }
      if (problem.problem.code === 'unavailable')
        throw new ProjectLocalDraftOnlyError(local)
      throw problem
    }
  }

  return {
    latestWrite: readonly(latestWrite),
    hydrate,
    saveForm,
    startNewProject,
    rebase,
    acceptLatest,
  }
})
