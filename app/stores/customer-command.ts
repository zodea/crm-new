import type { CustomerCommandContextDTO, CustomerFormReadDTO } from '~/lib/customer/command-contract'
import type { CustomerFormDraft, FormAttachment, FormAttachmentChanges, MasterDataSaveAction } from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { readonly, shallowReactive, shallowRef } from 'vue'
import { CUSTOMER_WRITE_CAPABILITY } from '~/lib/customer/command-contract'
import { clearCustomerPending, customerPendingKey, readCustomerPending, rememberCustomerPending } from '~/lib/customer/pending'
import { customerProblemFromUnknown } from '~/lib/customer/repository'
import { createFormCommandActions } from '~/lib/forms/command-session'

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
    super(alreadyApplied ? '上次提交已经保存，请核对原提交；当前未保存输入仍在页面。' : '客户已有更新版本，请选择如何处理')
    this.name = 'CustomerCommandConflictError'
  }
}
export const useCustomerCommandStore = defineStore('customer-command', () => {
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const repository = () => useNuxtApp().$repositories.customerCommands
  const formal = createFormCommandActions<CustomerCommandContextDTO, typeof CUSTOMER_WRITE_CAPABILITY, CustomerFormDraft, MasterDataSaveAction, FormAttachmentChanges, CustomerFormReadDTO>({
    capability: CUSTOMER_WRITE_CAPABILITY,
    problemFromUnknown: customerProblemFromUnknown,
    conflict: latest => new CustomerCommandConflictError(latest),
    repository: () => ({
      loadForm: id => repository().loadForm(id),
      execute: request => repository().execute(request),
      context: async () => {
        const context = await repository().context()
        if (!context.capabilities.includes('customer:original:write'))
          throw new Error('当前正式客户权限或来源已变化，请保留原编号。')
        return context
      },
      resolve: async (commandId) => {
        const resolved = await useNuxtApp().$repositories.customerProduction.resolve(commandId)
        if (resolved.outcome === 'applied' && resolved.result)
          return { outcome: 'applied' as const, result: resolved.result }
        if (resolved.outcome === 'not-applied' && resolved.commandId === commandId && resolved.result === null)
          return { outcome: 'not-applied' as const, commandId }
        throw new Error('原客户提交核对结果无效，请保留原编号。')
      },
    }),
    recoveryAdapter: {
      key: scope => customerPendingKey({ ...scope, capabilities: [] }, `form:${scope.targetId ?? 'new'}`),
      read: (key, scope) => {
        const commandId = readCustomerPending(key)
        return commandId ? { ...scope, commandId, action: 'recover' } : null
      },
      remember: (key, descriptor) => rememberCustomerPending(key, descriptor.commandId),
      verify: (key, commandId) => {
        if (readCustomerPending(key) !== commandId)
          throw new Error('原提交编号已经变化，请重新核对。')
      },
      clear: clearCustomerPending,
    },
  })
  function createSession() {
    return shallowReactive({ targetCustomerId: null as string | null, baseVersion: null as string | null, pendingCommand: null as { id: string, fingerprint: string } | null, storesOriginals: false, loadGeneration: 0, authority: null as { workspaceId: string, actorId: string } | null, persistent: formal.createSession() })
  }
  type Session = ReturnType<typeof createSession>
  function deactivate(session: Session) {
    session.loadGeneration++
    formal.invalidate(session.persistent)
  }
  async function revalidate(session: Session) {
    if (session.storesOriginals)
      return formal.revalidate(session.persistent)
    const generation = session.loadGeneration
    const target = session.targetCustomerId
    const context = await repository().context()
    const current = () => generation === session.loadGeneration && target === session.targetCustomerId && !session.storesOriginals
    if (!current() || !session.authority || context.workspaceId !== session.authority.workspaceId || context.actorId !== session.authority.actorId || !context.capabilities.includes(CUSTOMER_WRITE_CAPABILITY) || context.capabilities.includes('customer:original:write'))
      throw new Error('原客户表单权限或来源已变化，请保留输入。')
    const form = target ? await repository().loadForm(target) : null
    if (!current() || (form && form.draft.id !== target))
      throw new Error('重新读取与原客户目标不一致。')
    return { form, context }
  }
  async function hydrate(session: Session, id: string | null): Promise<HydratedCustomerCommandForm> {
    const request = ++session.loadGeneration
    const generation = session.persistent.generation
    const context = await repository().context()
    if (session.loadGeneration !== request || session.persistent.generation !== generation)
      throw new Error('此读取不属于当前客户页面。')
    session.storesOriginals = context.capabilities.includes('customer:original:write')
    const read = session.storesOriginals ? await formal.hydrate(session.persistent, id) : { form: id ? await repository().loadForm(id) : null, recovered: false, recoveryOutcome: null }
    if (session.loadGeneration !== request || session.persistent.generation !== generation + (session.storesOriginals ? 1 : 0))
      throw new Error('此读取不属于当前客户页面。')
    session.authority = { workspaceId: context.workspaceId, actorId: context.actorId }
    session.targetCustomerId = read.form?.draft.id ?? id
    session.baseVersion = read.form?.version ?? null
    return { draft: read.form?.draft ?? null, attachments: read.form?.attachments ?? [], pendingAttachments: [], pendingRemoveIds: [], pendingRestoreIds: [], restoredLocalDraft: null, productionNotice: read.recoveryOutcome === 'applied' ? '已核对上次提交：保存成功，现已读取磁盘中的客户。' : read.recovered ? '已核对上次提交：没有保存，迟到请求已封存。刷新前未保存的输入和附件需重新选择。' : '' }
  }
  function startNewCustomer(session: Session) {
    if (session.storesOriginals)
      formal.startNew(session.persistent)
    session.targetCustomerId = null
    session.baseVersion = null
    session.pendingCommand = null
  }
  function rebase(session: Session, version: string) {
    if (session.storesOriginals) {
      if (session.persistent.pending)
        throw new Error('请先核对原提交，再采用新的客户版本。')
      session.persistent.baseVersion = version
    }
    session.baseVersion = version
  }
  function acceptLatest(session: Session, latest: CustomerFormReadDTO) {
    if (session.storesOriginals)
      formal.adoptConflictVersion(session.persistent, latest)
    session.targetCustomerId = latest.draft.id
    session.baseVersion = latest.version
  }
  async function recover(session: Session) {
    const resolved = await formal.recover(session.persistent)
    session.targetCustomerId = session.persistent.targetId
    session.baseVersion = session.persistent.baseVersion
    if (resolved.outcome === 'applied')
      latestWrite.value = { id: resolved.result.id, version: resolved.result.version }
    return resolved
  }
  async function saveForm(session: Session, draft: CustomerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    if (session.storesOriginals) {
      const result = await formal.saveForm(session.persistent, draft, action, attachments)
      session.targetCustomerId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { ...result, logId: null }
    }
    const generation = session.loadGeneration
    const assertCurrent = () => {
      if (generation !== session.loadGeneration || session.storesOriginals)
        throw new Error('原客户页面已变化，请保留原提交并回原页面核对。')
    }
    const id = session.targetCustomerId ?? draft.id ?? null
    const context = await repository().context()
    assertCurrent()
    if (!context.capabilities.includes(CUSTOMER_WRITE_CAPABILITY) || (session.authority && (context.workspaceId !== session.authority.workspaceId || context.actorId !== session.authority.actorId)) || context.capabilities.includes('customer:original:write'))
      throw new Error('请先重新读取正式客户表单，再保存资料。')
    const content = JSON.parse(JSON.stringify({ ...(id ? { id } : {}), baseVersion: session.baseVersion, action, draft: { ...draft, ...(id ? { id } : {}) }, attachments }))
    const fingerprint = JSON.stringify(content)
    if (session.pendingCommand && session.pendingCommand.fingerprint !== fingerprint)
      throw new Error('原提交结果未知，当前输入不能替换原命令。')
    session.pendingCommand ??= { id: crypto.randomUUID(), fingerprint }
    const commandId = session.pendingCommand.id
    try {
      const result = await repository().execute({ ...content, workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: CUSTOMER_WRITE_CAPABILITY, commandId })
      assertCurrent()
      if (result.commandId !== commandId)
        throw new Error('客户回执编号与原提交不一致，请核对原提交')
      session.pendingCommand = null
      session.targetCustomerId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { id: result.id, logId: null, attachmentIds: result.attachmentIds }
    }
    catch (cause) {
      assertCurrent()
      const problem = customerProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id) {
        const latest = await repository().loadForm(id)
        assertCurrent()
        throw new CustomerCommandConflictError(latest)
      }
      throw problem
    }
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
  return { latestWrite: readonly(latestWrite), createSession, hydrate, revalidate, deactivate, saveForm, recover, startNewCustomer, rebase, acceptLatest, pendingForms, downloadOriginal: (customerId: string, fileId: string) => useNuxtApp().$repositories.customerProduction.file(customerId, fileId) }
})
