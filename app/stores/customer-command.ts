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
  function createSession() {
    return { targetCustomerId: null as string | null, baseVersion: null as string | null, pendingCommand: null as { id: string, fingerprint: string } | null }
  }
  type CommandSession = ReturnType<typeof createSession>

  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const repository = () => useNuxtApp().$repositories.customerCommands

  async function hydrate(session: CommandSession, id: string | null): Promise<HydratedCustomerCommandForm> {
    session.targetCustomerId = id
    session.pendingCommand = null
    const form = id ? await repository().loadForm(id) : null
    session.baseVersion = form?.version ?? null
    return {
      draft: form?.draft ?? null,
      attachments: form?.attachments ?? [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
    }
  }

  function startNewCustomer(session: CommandSession) {
    session.targetCustomerId = null
    session.baseVersion = null
    session.pendingCommand = null
  }

  function rebase(session: CommandSession, version: string) {
    session.baseVersion = version
  }

  function acceptLatest(session: CommandSession, latest: CustomerFormReadDTO) {
    session.targetCustomerId = latest.draft.id
    session.baseVersion = latest.version
  }

  async function saveForm(session: CommandSession, draft: CustomerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    const id = session.targetCustomerId ?? draft.id ?? null
    const context = await repository().context()
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
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        requiredCapability: CUSTOMER_WRITE_CAPABILITY,
        commandId: session.pendingCommand.id,
        baseVersion: session.baseVersion,
        action,
        draft: content.draft,
        attachments,
      })
      session.pendingCommand = null
      session.targetCustomerId = result.id
      session.baseVersion = result.version
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
    createSession,
    hydrate,
    saveForm,
    startNewCustomer,
    rebase,
    acceptLatest,
  }
})
