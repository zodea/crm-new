import type { ConstructionContractCommandContextDTO, ConstructionContractFormReadDTO } from '~/lib/construction-contract/command-contract'
import type { ContractFormAttachmentChanges, F2SaveAction, ProjectContractFormDraft } from '~/lib/contract/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { CONSTRUCTION_CONTRACT_WRITE_CAPABILITY } from '~/lib/construction-contract/command-contract'
import { constructionContractProblemFromUnknown } from '~/lib/construction-contract/repository'

export class ConstructionContractCommandConflictError extends Error {
  constructor(public readonly latest: ConstructionContractFormReadDTO) {
    super('施工合同已有更新版本，请载入最新版本后继续')
    this.name = 'ConstructionContractCommandConflictError'
  }
}

export const useConstructionContractCommandStore = defineStore('construction-contract-command', () => {
  const targetId = shallowRef<string | null>(null)
  const baseVersion = shallowRef<string | null>(null)
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const contextValue = shallowRef<ConstructionContractCommandContextDTO | null>(null)
  let pendingCommand: { id: string, fingerprint: string } | null = null
  const repository = () => useNuxtApp().$repositories.constructionContractCommands

  async function context() {
    contextValue.value ??= await repository().context()
    return contextValue.value
  }

  async function hydrate(id: string | null) {
    contextValue.value = null
    targetId.value = id
    pendingCommand = null
    const [form, commandContext] = await Promise.all([
      id ? repository().loadForm(id) : Promise.resolve(null),
      context(),
    ])
    baseVersion.value = form?.version ?? null
    return { form, context: commandContext }
  }

  async function saveForm(draft: ProjectContractFormDraft, action: F2SaveAction, attachments: ContractFormAttachmentChanges = {}) {
    const id = targetId.value ?? draft.id ?? null
    const commandContext = await context()
    const content = { id, baseVersion: baseVersion.value, action, draft, attachments }
    const fingerprint = JSON.stringify(content)
    if (!pendingCommand || pendingCommand.fingerprint !== fingerprint)
      pendingCommand = { id: crypto.randomUUID(), fingerprint }
    try {
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: commandContext.workspaceId,
        actorId: commandContext.actorId,
        requiredCapability: CONSTRUCTION_CONTRACT_WRITE_CAPABILITY,
        commandId: pendingCommand.id,
        baseVersion: baseVersion.value,
        action,
        draft: { ...draft, ...(id ? { id } : {}) },
        attachments,
      })
      pendingCommand = null
      targetId.value = result.id
      baseVersion.value = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return result
    }
    catch (cause) {
      const problem = constructionContractProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id)
        throw new ConstructionContractCommandConflictError(await repository().loadForm(id))
      throw problem
    }
  }

  function adoptConflictVersion(latest: ConstructionContractFormReadDTO) {
    targetId.value = latest.draft.id ?? targetId.value
    baseVersion.value = latest.version
    pendingCommand = null
  }

  return { latestWrite: readonly(latestWrite), hydrate, saveForm, adoptConflictVersion }
})
