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
  const targets = shallowRef<Record<'crew' | 'worker', string | null>>({ crew: null, worker: null })
  const versions = shallowRef<Record<'crew' | 'worker', string | null>>({ crew: null, worker: null })
  const latestWrite = shallowRef<{ kind: 'crew' | 'worker', id: string, version: string } | null>(null)
  const pending = new Map<'crew' | 'worker', { id: string, fingerprint: string }>()
  const repository = () => useNuxtApp().$repositories.crewWorkerCommands

  async function hydrate(kind: 'crew' | 'worker', id: string | null) {
    targets.value = { ...targets.value, [kind]: id }
    pending.delete(kind)
    const form = id
      ? kind === 'crew' ? await repository().loadCrewForm(id) : await repository().loadWorkerForm(id)
      : null
    versions.value = { ...versions.value, [kind]: form?.version ?? null }
    return {
      draft: form?.draft ?? null,
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
    }
  }

  function startNew(kind: 'crew' | 'worker') {
    targets.value = { ...targets.value, [kind]: null }
    versions.value = { ...versions.value, [kind]: null }
    pending.delete(kind)
  }

  function rebase(kind: 'crew' | 'worker', version: string) {
    versions.value = { ...versions.value, [kind]: version }
  }

  function acceptLatest(kind: 'crew' | 'worker', latest: CrewFormReadDTO | WorkerFormReadDTO) {
    targets.value = { ...targets.value, [kind]: latest.draft.id }
    versions.value = { ...versions.value, [kind]: latest.version }
  }

  async function saveCrew(draft: CrewFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    return save('crew', draft, action, attachments)
  }

  async function saveWorker(draft: WorkerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    return save('worker', draft, action, attachments)
  }

  async function save(kind: 'crew', draft: CrewFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges): Promise<{ id: string, logId: null, attachmentIds: string[] }>
  async function save(kind: 'worker', draft: WorkerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges): Promise<{ id: string, logId: null, attachmentIds: string[] }>
  async function save(kind: 'crew' | 'worker', draft: CrewFormDraft | WorkerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges) {
    const id = targets.value[kind] ?? draft.id ?? null
    const changes = emptyChanges(attachments)
    const content = { id, baseVersion: versions.value[kind], action, draft: { ...draft, ...(id ? { id } : {}) }, attachments: changes }
    const fingerprint = JSON.stringify(content)
    let command = pending.get(kind)
    if (!command || command.fingerprint !== fingerprint) {
      command = { id: crypto.randomUUID(), fingerprint }
      pending.set(kind, command)
    }
    try {
      const context = await repository().context()
      const common = {
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        commandId: command.id,
        baseVersion: versions.value[kind],
        action,
        attachments: changes,
      }
      const result = kind === 'crew'
        ? await repository().executeCrew({ ...common, requiredCapability: CREW_WRITE_CAPABILITY, draft: content.draft as CrewFormDraft })
        : await repository().executeWorker({ ...common, requiredCapability: WORKER_WRITE_CAPABILITY, draft: content.draft as WorkerFormDraft })
      pending.delete(kind)
      targets.value = { ...targets.value, [kind]: result.id }
      versions.value = { ...versions.value, [kind]: result.version }
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

  return { latestWrite: readonly(latestWrite), hydrate, saveCrew, saveWorker, startNew, rebase, acceptLatest }
})
