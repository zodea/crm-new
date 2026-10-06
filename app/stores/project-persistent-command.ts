import type { FormAttachment, FormAttachmentChanges, MasterDataSaveAction, ProjectFormDraft } from '~/lib/master-data/forms'
import type { ProjectCommandContextDTO, ProjectFormReadDTO } from '~/lib/project/command-contract'
import { defineStore } from 'pinia'
import { createFormCommandActions } from '~/lib/forms/command-session'
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
    super(alreadyApplied ? '上次提交已经保存，请核对原提交；当前未保存输入仍在页面。' : '项目已有更新版本，请选择如何处理')
    this.name = 'ProjectPersistentConflictError'
  }
}
export const useProjectPersistentCommandStore = defineStore('project-persistent-command', () => {
  const repository = () => useNuxtApp().$repositories.projectCommands
  const actions = createFormCommandActions<ProjectCommandContextDTO, typeof PROJECT_WRITE_CAPABILITY, ProjectFormDraft, MasterDataSaveAction, FormAttachmentChanges, ProjectFormReadDTO>({
    capability: PROJECT_WRITE_CAPABILITY,
    problemFromUnknown: projectProblemFromUnknown,
    conflict: latest => new ProjectPersistentConflictError(latest),
    repository: () => ({ ...repository(), context: async () => {
      const context = await repository().context()
      if (!context.capabilities.includes('project:original:write'))
        throw new Error('当前正式项目权限或来源已变化，请保留原编号。')
      return context
    }, resolve: async (commandId) => {
      const resolved = await useNuxtApp().$repositories.projectProduction.resolve(commandId)
      if (resolved.outcome === 'applied' && resolved.result)
        return { outcome: 'applied' as const, result: resolved.result }
      if (resolved.outcome === 'not-applied' && resolved.commandId === commandId && resolved.result === null)
        return { outcome: 'not-applied' as const, commandId }
      throw new Error('原项目提交核对结果无效，请保留原编号。')
    } }),
    recoveryAdapter: {
      key: scope => projectPendingKey({ ...scope, capabilities: [] }, `form:${scope.targetId ?? 'new'}`),
      read: (key, scope) => {
        const commandId = readProjectPending(key)
        return commandId ? { ...scope, commandId, action: 'recover' } : null
      },
      remember: (key, descriptor) => rememberProjectPending(key, descriptor.commandId),
      verify: (key, commandId) => {
        if (readProjectPending(key) !== commandId)
          throw new Error('原提交编号已经变化，请重新核对。')
      },
      clear: clearProjectPending,
    },
  })
  function createSession() {
    const session = actions.createSession()
    return Object.defineProperty(session, 'targetProjectId', { get: () => session.targetId }) as typeof session & { readonly targetProjectId: string | null }
  }
  type Session = ReturnType<typeof createSession>
  async function hydrate(session: Session, id: string | null): Promise<HydratedPersistentProjectForm> {
    const read = await actions.hydrate(session, id)
    return { draft: read.form?.draft ?? null, attachments: read.form?.attachments ?? [], pendingAttachments: [], pendingRemoveIds: [], pendingRestoreIds: [], restoredLocalDraft: null, productionNotice: read.recoveryOutcome === 'applied' ? '已核对上次提交：保存成功，现已读取磁盘中的项目。' : read.recovered ? '已核对上次提交：没有保存，迟到请求已封存。刷新前未保存的输入和附件需重新选择。' : '' }
  }
  function rebase(session: Session, version: string) {
    if (session.pending)
      throw new Error('请先核对原提交，再采用新的项目版本。')
    session.baseVersion = version
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
  return { latestWrite: actions.latestWrite, createSession, hydrate, revalidate: actions.revalidate, deactivate: actions.invalidate, saveForm: actions.saveForm, recover: actions.recover, startNewProject: actions.startNew, rebase, acceptLatest: actions.adoptConflictVersion, pendingForms, downloadOriginal: (projectId: string, fileId: string) => useNuxtApp().$repositories.projectProduction.file(projectId, fileId) }
})
