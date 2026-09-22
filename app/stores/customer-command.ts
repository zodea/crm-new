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
import { clearCustomerPending, customerPendingKey, readCustomerPending, rememberCustomerPending } from '~/lib/customer/pending'
import { customerProblemFromUnknown } from '~/lib/customer/repository'

export interface HydratedCustomerCommandForm {
  draft: CustomerFormDraft | null
  attachments: FormAttachment[]
  pendingAttachments: NonNullable<FormAttachmentChanges['add']>
  pendingRemoveIds: string[]
  pendingRestoreIds: string[]
  restoredLocalDraft: null
  productionNotice: string
}

export class CustomerCommandConflictError extends Error {
  constructor(public readonly latest: CustomerFormReadDTO, public readonly alreadyApplied = false) {
    super(alreadyApplied ? '上次提交已经保存，请先读取已保存内容；当前未保存输入仍在页面。' : '客户已有更新版本，请选择如何处理')
    this.name = 'CustomerCommandConflictError'
  }
}

export const useCustomerCommandStore = defineStore('customer-command', () => {
  function createSession() {
    return { targetCustomerId: null as string | null, baseVersion: null as string | null, pendingCommand: null as { id: string, fingerprint: string } | null, storesOriginals: false, pendingKey: '', resolvedPending: null as { key: string, commandId: string } | null }
  }
  type CommandSession = ReturnType<typeof createSession>

  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const repository = () => useNuxtApp().$repositories.customerCommands

  async function hydrate(session: CommandSession, id: string | null): Promise<HydratedCustomerCommandForm> {
    const context = await repository().context()
    session.storesOriginals = context.capabilities.includes('customer:original:write')
    session.pendingKey = session.storesOriginals ? customerPendingKey(context, `form:${id ?? 'new'}`) : ''
    let productionNotice = ''
    let recoveredCommand: string | null = null
    if (session.pendingKey) {
      const commandId = readCustomerPending(session.pendingKey)
      if (commandId) {
        const resolved = await useNuxtApp().$repositories.customerProduction.resolve(commandId)
        if (resolved.result) {
          id = resolved.result.id
          productionNotice = '已核对上次提交：保存成功，现已读取磁盘中的客户。'
        }
        else {
          productionNotice = '已核对上次提交：没有保存，迟到请求已封存。刷新前未保存的输入和附件需重新选择。'
        }
        recoveredCommand = commandId
      }
    }
    session.targetCustomerId = id
    session.pendingCommand = null
    const form = id ? await repository().loadForm(id) : null
    if (recoveredCommand)
      clearCustomerPending(session.pendingKey, recoveredCommand)
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

  function startNewCustomer(session: CommandSession) {
    session.resolvedPending = null
    session.targetCustomerId = null
    session.baseVersion = null
    session.pendingCommand = null
  }

  function rebase(session: CommandSession, version: string) {
    session.baseVersion = version
  }

  function acceptLatest(session: CommandSession, latest: CustomerFormReadDTO) {
    if (session.resolvedPending) {
      clearCustomerPending(session.resolvedPending.key, session.resolvedPending.commandId)
      session.resolvedPending = null
    }
    session.targetCustomerId = latest.draft.id
    session.baseVersion = latest.version
  }

  async function saveForm(session: CommandSession, draft: CustomerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    const id = session.targetCustomerId ?? draft.id ?? null
    const context = await repository().context()
    const persistent = context.capabilities.includes('customer:original:write')
    const pendingKey = persistent ? customerPendingKey(context, `form:${draft.id ?? 'new'}`) : ''
    if (pendingKey) {
      const prior = readCustomerPending(pendingKey)
      if (prior) {
        const resolved = await useNuxtApp().$repositories.customerProduction.resolve(prior)
        if (resolved.result) {
          const latest = await repository().loadForm(resolved.result.id)
          session.resolvedPending = { key: pendingKey, commandId: prior }
          session.targetCustomerId = resolved.result.id
          session.pendingCommand = null
          throw new CustomerCommandConflictError(latest, true)
        }
        clearCustomerPending(pendingKey, prior)
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
        rememberCustomerPending(pendingKey, session.pendingCommand.id)
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
      if (result.commandId !== session.pendingCommand.id)
        throw new Error('客户回执编号与原提交不一致，请核对原提交')
      if (pendingKey)
        clearCustomerPending(pendingKey, session.pendingCommand.id)
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

  function downloadOriginal(customerId: string, fileId: string) {
    return useNuxtApp().$repositories.customerProduction.file(customerId, fileId)
  }

  async function pendingForms() {
    const context = await repository().context()
    if (!context.capabilities.includes('customer:original:write'))
      return []
    const prefix = customerPendingKey(context, 'form:')
    const paths: string[] = []
    for (let index = 0; index < window.sessionStorage.length; index++) {
      const key = window.sessionStorage.key(index)
      if (!key?.startsWith(prefix) || !readCustomerPending(key))
        continue
      const target = decodeURIComponent(key.slice(prefix.length))
      if (target === 'new')
        paths.push('/base/customer/form')
      else if (/^[a-z0-9][\w-]{2,79}$/i.test(target))
        paths.push(`/base/customer/form/${encodeURIComponent(target)}?origin=real`)
    }
    return paths
  }

  return {
    latestWrite: readonly(latestWrite),
    createSession,
    hydrate,
    saveForm,
    startNewCustomer,
    rebase,
    acceptLatest,
    downloadOriginal,
    pendingForms,
  }
})
