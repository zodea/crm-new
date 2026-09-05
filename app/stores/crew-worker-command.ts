import type { CrewFormReadDTO, WorkerFormReadDTO } from '~/lib/crew-worker/command-contract'
import type { CrewFormDraft, FormAttachmentChanges, MasterDataSaveAction, WorkerFormDraft } from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { CREW_WRITE_CAPABILITY, WORKER_WRITE_CAPABILITY } from '~/lib/crew-worker/command-contract'
import { crewWorkerProblemFromUnknown } from '~/lib/crew-worker/repository'

export class CrewWorkerCommandConflictError extends Error {
  constructor(public readonly kind: 'crew' | 'worker', public readonly latest: CrewFormReadDTO | WorkerFormReadDTO) {
    super(`${kind === 'crew' ? '班组' : '工人'}已有更新版本，请选择如何处理`)
    this.name = 'CrewWorkerCommandConflictError'
  }
}

function emptyChanges(changes: FormAttachmentChanges): FormAttachmentChanges {
  return {
    ...(changes.add?.length ? { add: changes.add } : {}),
    ...(changes.removeIds?.length ? { removeIds: changes.removeIds } : {}),
    ...(changes.restoreIds?.length ? { restoreIds: changes.restoreIds } : {}),
  }
}

export const useCrewWorkerCommandStore = defineStore('crew-worker-command', () => {
  function createSession() {
    return { targets: { crew: null, worker: null } as Record<'crew' | 'worker', string | null>, versions: { crew: null, worker: null } as Record<'crew' | 'worker', string | null>, pending: new Map<'crew' | 'worker', { id: string, fingerprint: string }>() }
  }
  type CommandSession = ReturnType<typeof createSession>
  const latestWrite = shallowRef<{ kind: 'crew' | 'worker', id: string, version: string } | null>(null)
  const repository = () => useNuxtApp().$repositories.crewWorkerCommands

  async function hydrate(session: CommandSession, kind: 'crew' | 'worker', id: string | null) {
    session.targets = { ...session.targets, [kind]: id }
    session.pending.delete(kind)
    const form = id
      ? kind === 'crew' ? await repository().loadCrewForm(id) : await repository().loadWorkerForm(id)
      : null
    session.versions = { ...session.versions, [kind]: form?.version ?? null }
    return {
      draft: form?.draft ?? null,
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
    }
  }

  function startNew(session: CommandSession, kind: 'crew' | 'worker') {
    session.targets = { ...session.targets, [kind]: null }
    session.versions = { ...session.versions, [kind]: null }
    session.pending.delete(kind)
  }

  function rebase(session: CommandSession, kind: 'crew' | 'worker', version: string) {
    session.versions = { ...session.versions, [kind]: version }
  }

  function acceptLatest(session: CommandSession, kind: 'crew' | 'worker', latest: CrewFormReadDTO | WorkerFormReadDTO) {
    session.targets = { ...session.targets, [kind]: latest.draft.id }
    session.versions = { ...session.versions, [kind]: latest.version }
  }

  async function saveCrew(session: CommandSession, draft: CrewFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    return save(session, 'crew', draft, action, attachments)
  }

  async function saveWorker(session: CommandSession, draft: WorkerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    return save(session, 'worker', draft, action, attachments)
  }

  async function save(session: CommandSession, kind: 'crew', draft: CrewFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges): Promise<{ id: string, logId: null, attachmentIds: string[] }>
  async function save(session: CommandSession, kind: 'worker', draft: WorkerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges): Promise<{ id: string, logId: null, attachmentIds: string[] }>
  async function save(session: CommandSession, kind: 'crew' | 'worker', draft: CrewFormDraft | WorkerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges) {
    const id = session.targets[kind] ?? draft.id ?? null
    const changes = emptyChanges(attachments)
    const content = { id, baseVersion: session.versions[kind], action, draft: { ...draft, ...(id ? { id } : {}) }, attachments: changes }
    const fingerprint = JSON.stringify(content)
    let command = session.pending.get(kind)
    if (!command || command.fingerprint !== fingerprint) {
      command = { id: crypto.randomUUID(), fingerprint }
      session.pending.set(kind, command)
    }
    try {
      const context = await repository().context()
      const common = {
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        commandId: command.id,
        baseVersion: session.versions[kind],
        action,
        attachments: changes,
      }
      const result = kind === 'crew'
        ? await repository().executeCrew({ ...common, requiredCapability: CREW_WRITE_CAPABILITY, draft: content.draft as CrewFormDraft })
        : await repository().executeWorker({ ...common, requiredCapability: WORKER_WRITE_CAPABILITY, draft: content.draft as WorkerFormDraft })
      session.pending.delete(kind)
      session.targets = { ...session.targets, [kind]: result.id }
      session.versions = { ...session.versions, [kind]: result.version }
      latestWrite.value = { kind, id: result.id, version: result.version }
      return { id: result.id, logId: null, attachmentIds: result.attachmentIds }
    }
    catch (cause) {
      const problem = crewWorkerProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id) {
        const latest = kind === 'crew' ? await repository().loadCrewForm(id) : await repository().loadWorkerForm(id)
        throw new CrewWorkerCommandConflictError(kind, latest)
      }
      throw problem
    }
  }

  return { latestWrite: readonly(latestWrite), createSession, hydrate, saveCrew, saveWorker, startNew, rebase, acceptLatest }
})
