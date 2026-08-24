import type { ContractFormAttachmentChanges, F2SaveAction, ProjectContractFormDraft } from '~/lib/contract/forms'
import type { SubcontractContractCommandContextDTO, SubcontractContractFormReadDTO } from '~/lib/subcontract-contract/command-contract'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { SUBCONTRACT_CONTRACT_WRITE_CAPABILITY } from '~/lib/subcontract-contract/command-contract'
import { subcontractContractUnavailable } from '~/lib/subcontract-contract/repository'

export class SubcontractContractCommandConflictError extends Error {
  constructor(public readonly latest: SubcontractContractFormReadDTO) {
    super('分包合同已有更新版本，请载入最新版本后继续')
    this.name = 'SubcontractContractCommandConflictError'
  }
}

export const useSubcontractContractCommandStore = defineStore('subcontract-contract-command', () => {
  const targetId = shallowRef<string | null>(null)
  const baseVersion = shallowRef<string | null>(null)
  const contextValue = shallowRef<SubcontractContractCommandContextDTO | null>(null)
  let pendingCommand: { id: string, fingerprint: string } | null = null
  const repository = () => useNuxtApp().$repositories.subcontractContractCommands

  async function context() {
    contextValue.value ??= await repository().context()
    return contextValue.value
  }

  async function hydrate(id: string | null) {
    targetId.value = id
    pendingCommand = null
    const [form, commandContext] = await Promise.all([id ? repository().loadForm(id) : Promise.resolve(null), context()])
    baseVersion.value = form?.version ?? null
    return { form, context: commandContext }
  }

  async function saveForm(draft: ProjectContractFormDraft, action: F2SaveAction, attachments: ContractFormAttachmentChanges = {}) {
    const id = targetId.value ?? draft.id ?? null
    const commandContext = await context()
    const fingerprint = JSON.stringify({ id, baseVersion: baseVersion.value, action, draft, attachments })
    if (!pendingCommand || pendingCommand.fingerprint !== fingerprint)
      pendingCommand = { id: crypto.randomUUID(), fingerprint }
    try {
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: commandContext.workspaceId,
        actorId: commandContext.actorId,
        requiredCapability: SUBCONTRACT_CONTRACT_WRITE_CAPABILITY,
        commandId: pendingCommand.id,
        baseVersion: baseVersion.value,
        action,
        draft: { ...draft, ...(id ? { id } : {}) },
        attachments,
      })
      pendingCommand = null
      targetId.value = result.id
      baseVersion.value = result.version
      return result
    }
    catch (cause) {
      const problem = subcontractContractUnavailable(cause)
      if (problem.problem.code === 'conflict' && id)
        throw new SubcontractContractCommandConflictError(await repository().loadForm(id))
      throw problem
    }
  }

  function adoptConflictVersion(latest: SubcontractContractFormReadDTO) {
    targetId.value = latest.draft.id ?? targetId.value
    baseVersion.value = latest.version
    pendingCommand = null
  }

  return { hydrate, saveForm, adoptConflictVersion }
})
