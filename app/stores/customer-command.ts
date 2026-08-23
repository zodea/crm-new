import type { CustomerFormReadDTO } from '~/lib/customer/command-contract'
import type {
  CustomerFormDraft,
  FormAttachment,
  FormAttachmentChanges,
  MasterDataSaveAction,
} from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { CUSTOMER_WRITE_CAPABILITY } from '~/lib/customer/command-contract'
import { customerProblemFromUnknown } from '~/lib/customer/repository'

export interface HydratedCustomerCommandForm {
  draft: CustomerFormDraft | null
  attachments: FormAttachment[]
  pendingAttachments: NonNullable<FormAttachmentChanges['add']>
  pendingRemoveIds: string[]
  pendingRestoreIds: string[]
  restoredLocalDraft: null
}

export class CustomerCommandConflictError extends Error {
  constructor(public readonly latest: CustomerFormReadDTO) {
    super('客户已有更新版本，请选择如何处理')
    this.name = 'CustomerCommandConflictError'
  }
}

export const useCustomerCommandStore = defineStore('customer-command', () => {
  const targetCustomerId = shallowRef<string | null>(null)
  const baseVersion = shallowRef<string | null>(null)
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  let pendingCommand: { id: string, fingerprint: string } | null = null
  const repository = () => useNuxtApp().$repositories.customerCommands

  async function hydrate(id: string | null): Promise<HydratedCustomerCommandForm> {
    targetCustomerId.value = id
    pendingCommand = null
    const form = id ? await repository().loadForm(id) : null
    baseVersion.value = form?.version ?? null
    return {
      draft: form?.draft ?? null,
      attachments: form?.attachments ?? [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
    }
  }

  function startNewCustomer() {
    targetCustomerId.value = null
    baseVersion.value = null
    pendingCommand = null
  }

  function rebase(version: string) {
    baseVersion.value = version
  }

  function acceptLatest(latest: CustomerFormReadDTO) {
    targetCustomerId.value = latest.draft.id
    baseVersion.value = latest.version
  }

  async function saveForm(draft: CustomerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    const id = targetCustomerId.value ?? draft.id ?? null
    const context = await repository().context()
    const content = {
      id,
      baseVersion: baseVersion.value,
      action,
      draft: { ...draft, ...(id ? { id } : {}) },
      attachments,
    }
    const fingerprint = JSON.stringify(content)
    if (!pendingCommand || pendingCommand.fingerprint !== fingerprint) {
      pendingCommand = {
        id: crypto.randomUUID(),
        fingerprint,
      }
    }
    try {
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        requiredCapability: CUSTOMER_WRITE_CAPABILITY,
        commandId: pendingCommand.id,
        baseVersion: baseVersion.value,
        action,
        draft: content.draft,
        attachments,
      })
      pendingCommand = null
      targetCustomerId.value = result.id
      baseVersion.value = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { id: result.id, logId: null, attachmentIds: result.attachmentIds }
    }
    catch (cause) {
      const problem = customerProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id)
        throw new CustomerCommandConflictError(await repository().loadForm(id))
      throw problem
    }
  }

  return {
    latestWrite: readonly(latestWrite),
    hydrate,
    saveForm,
    startNewCustomer,
    rebase,
    acceptLatest,
  }
})
