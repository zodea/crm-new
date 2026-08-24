import type { ContractFormAttachmentChanges, F2SaveAction, ProjectContractFormDraft } from '~/lib/contract/forms'
import type { MaterialContractCommandContextDTO, MaterialContractFormReadDTO } from '~/lib/material-contract/command-contract'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { MATERIAL_CONTRACT_WRITE_CAPABILITY } from '~/lib/material-contract/command-contract'
import { materialContractProblemFromUnknown } from '~/lib/material-contract/repository'

export class MaterialContractCommandConflictError extends Error {
  constructor(public readonly latest: MaterialContractFormReadDTO) {
    super('材料采购合同已有更新版本，请载入最新版本后继续')
    this.name = 'MaterialContractCommandConflictError'
  }
}

export const useMaterialContractCommandStore = defineStore('material-contract-command', () => {
  const targetId = shallowRef<string | null>(null)
  const baseVersion = shallowRef<string | null>(null)
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const contextValue = shallowRef<MaterialContractCommandContextDTO | null>(null)
  let pendingCommand: { id: string, fingerprint: string } | null = null
  const repository = () => useNuxtApp().$repositories.materialContractCommands

  async function context() {
    contextValue.value ??= await repository().context()
    return contextValue.value
  }

  async function hydrate(id: string | null) {
    targetId.value = id
    pendingCommand = null
    const [form, commandContext] = await Promise.all([
      id ? repository().loadForm(id) : Promise.resolve(null),
      context(),
    ])
    baseVersion.value = form?.version ?? null
    return { form, context: commandContext }
  }

  async function saveForm(
    draft: ProjectContractFormDraft,
    action: F2SaveAction,
    attachments: ContractFormAttachmentChanges = {},
  ) {
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
        requiredCapability: MATERIAL_CONTRACT_WRITE_CAPABILITY,
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
      const problem = materialContractProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id)
        throw new MaterialContractCommandConflictError(await repository().loadForm(id))
      throw problem
    }
  }

  function adoptConflictVersion(latest: MaterialContractFormReadDTO) {
    targetId.value = latest.draft.id ?? targetId.value
    baseVersion.value = latest.version
    pendingCommand = null
  }

  return { latestWrite: readonly(latestWrite), hydrate, saveForm, adoptConflictVersion }
})
