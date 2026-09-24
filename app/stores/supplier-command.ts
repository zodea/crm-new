import type { FormAttachmentChanges, MasterDataSaveAction, SupplierFormDraft } from '~/lib/master-data/forms'
import type { SupplierFormReadDTO } from '~/lib/supplier/command-contract'
import type { SupplierTaxpayerCommand, TaxpayerVerificationDraft } from '~/lib/supplier/taxpayer-verification'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { SUPPLIER_WRITE_CAPABILITY } from '~/lib/supplier/command-contract'
import { credentialProblem } from '~/lib/supplier/credential-contract'
import { createSupplierRowImporter } from '~/lib/supplier/import-command'
import { clearSupplierPending, readSupplierPending, rememberSupplierPending, SUPPLIER_PERSISTENT_CAPABILITY, supplierPendingKey, supplierPendingTargets } from '~/lib/supplier/pending'
import { supplierResultId } from '~/lib/supplier/production-repository'
import { supplierProblemFromUnknown } from '~/lib/supplier/repository'

export class SupplierCommandConflictError extends Error {
  constructor(public readonly latest: SupplierFormReadDTO, public readonly alreadyApplied = false) {
    super(alreadyApplied ? '上次分供方提交已保存，请先读取已保存内容；当前输入仍保留在页面。' : '分供方已有更新版本，请选择如何处理')
    this.name = 'SupplierCommandConflictError'
  }
}

export const useSupplierCommandStore = defineStore('supplier-command', () => {
  function createSession() {
    return { targetSupplierId: null as string | null, baseVersion: null as string | null, pendingCommand: null as { id: string, fingerprint: string } | null, pendingTaxpayerCommand: null as SupplierTaxpayerCommand | null, taxpayerBusy: false, persistent: false, resolvedPending: [] as { key: string, commandId: string }[] }
  }
  type CommandSession = ReturnType<typeof createSession>

  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const repository = () => useNuxtApp().$repositories.supplierCommands
  let rowImporter: ReturnType<typeof createSupplierRowImporter> | null = null

  async function importRow(row: Record<string, unknown>) {
    rowImporter ??= createSupplierRowImporter(repository())
    const result = await rowImporter(row)
    // 导入回读后通知缓存页面；不改变正在编辑的目标、版本或待重试保存命令。
    latestWrite.value = { id: result.id, version: result.version }
    return result
  }

  async function hydrate(session: CommandSession, id: string | null) {
    const context = await repository().context()
    session.persistent = context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)
    const recovered: { key: string, commandId: string }[] = []
    let productionNotice = ''
    if (session.persistent) {
      for (const target of [`form:${id ?? 'new'}`, ...(id ? [`taxpayer:${id}`] : [])]) {
        const key = supplierPendingKey(context, target)
        const commandId = readSupplierPending(key)
        if (!commandId)
          continue
        const resolved = await useNuxtApp().$repositories.supplierProduction.resolve(commandId)
        if (resolved.result) {
          const resolvedId = supplierResultId(resolved.result)
          if (id && id !== resolvedId)
            throw credentialProblem('relationship-mismatch', '原提交与当前分供方不一致，停止恢复。')
          id = resolvedId
          productionNotice = '已核对上次提交：保存成功，现已读取磁盘中的分供方。'
        }
        else {
          productionNotice = '已核对上次提交：没有保存，迟到请求已封存。刷新前的未保存输入需重新填写。'
        }
        recovered.push({ key, commandId })
      }
    }
    session.targetSupplierId = id
    session.pendingCommand = null
    session.pendingTaxpayerCommand = null
    const form = id ? await repository().loadForm(id) : null
    for (const pending of recovered) clearSupplierPending(pending.key, pending.commandId)
    session.resolvedPending = []
    session.baseVersion = form?.version ?? null
    return {
      draft: form?.draft ?? null,
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
      productionNotice,
    }
  }

  function startNewSupplier(session: CommandSession) {
    session.resolvedPending = []
    session.targetSupplierId = null
    session.baseVersion = null
    session.pendingCommand = null
    session.pendingTaxpayerCommand = null
  }

  function rebase(session: CommandSession, version: string) {
    session.baseVersion = version
  }

  function acceptLatest(session: CommandSession, latest: SupplierFormReadDTO) {
    for (const pending of session.resolvedPending) clearSupplierPending(pending.key, pending.commandId)
    session.resolvedPending = []
    session.targetSupplierId = latest.draft.id
    session.baseVersion = latest.version
  }

  async function saveForm(session: CommandSession, draft: SupplierFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    if (session.taxpayerBusy || session.pendingTaxpayerCommand)
      throw credentialProblem('conflict', '请先恢复并确认尚未完成的税务核验提交')
    const id = session.targetSupplierId ?? draft.id ?? null
    const context = await repository().context()
    const persistent = context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)
    if (session.persistent && !persistent)
      throw credentialProblem('forbidden', '正式分供方保存权限已变化，请重新读取并核对原提交。')
    const pendingKey = persistent ? supplierPendingKey(context, `form:${draft.id ?? 'new'}`) : ''
    for (const key of [pendingKey, ...(persistent && id ? [supplierPendingKey(context, `taxpayer:${id}`)] : [])].filter(Boolean)) {
      const prior = readSupplierPending(key)
      if (!prior)
        continue
      const resolved = await useNuxtApp().$repositories.supplierProduction.resolve(prior)
      if (resolved.result) {
        const resolvedId = supplierResultId(resolved.result)
        if (id && resolvedId !== id)
          throw credentialProblem('relationship-mismatch', '原提交与当前分供方不一致，停止恢复。')
        const latest = await repository().loadForm(resolvedId)
        session.resolvedPending = [{ key, commandId: prior }]
        session.targetSupplierId = resolvedId
        session.pendingCommand = null
        throw new SupplierCommandConflictError(latest, true)
      }
      clearSupplierPending(key, prior)
      session.pendingCommand = null
    }
    const attachmentChanges: FormAttachmentChanges = {
      ...(attachments.add?.length ? { add: attachments.add } : {}),
      ...(attachments.removeIds?.length ? { removeIds: attachments.removeIds } : {}),
      ...(attachments.restoreIds?.length ? { restoreIds: attachments.restoreIds } : {}),
    }
    const content = { id, baseVersion: session.baseVersion, action, draft: { ...draft, ...(id ? { id } : {}) }, attachments: attachmentChanges }
    const fingerprint = JSON.stringify(content)
    if (!session.pendingCommand || session.pendingCommand.fingerprint !== fingerprint)
      session.pendingCommand = { id: crypto.randomUUID(), fingerprint }
    try {
      if (pendingKey)
        rememberSupplierPending(pendingKey, session.pendingCommand.id)
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        requiredCapability: SUPPLIER_WRITE_CAPABILITY,
        commandId: session.pendingCommand.id,
        baseVersion: session.baseVersion,
        action,
        draft: content.draft,
        attachments: attachmentChanges,
      })
      if (result.commandId !== session.pendingCommand.id || (id && result.id !== id))
        throw credentialProblem('unavailable', '分供方回执与原提交不一致，请核对原编号。')
      if (pendingKey)
        clearSupplierPending(pendingKey, session.pendingCommand.id)
      session.pendingCommand = null
      session.targetSupplierId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { id: result.id, logId: null, attachmentIds: result.attachmentIds }
    }
    catch (cause) {
      const problem = supplierProblemFromUnknown(cause)
      if (!persistent && !['unavailable', 'internal-error'].includes(problem.problem.code))
        session.pendingCommand = null
      if (problem.problem.code === 'conflict' && id)
        throw new SupplierCommandConflictError(await repository().loadForm(id))
      throw problem
    }
  }

  async function recordTaxpayerVerification(session: CommandSession, input: { supplierId: string, origin: 'real' | 'demo', expectedTaxNo: string, baseSupplierVersion: string, draft: TaxpayerVerificationDraft }, isCurrent: () => boolean = () => true) {
    if (session.taxpayerBusy || session.pendingCommand)
      throw credentialProblem('conflict', '请先确认当前主档保存结果，再记录税务核验')
    const target = session.targetSupplierId
    const version = input.baseSupplierVersion
    if (input.origin !== 'real' || !target || target !== input.supplierId || !version || !input.expectedTaxNo.trim())
      throw credentialProblem('forbidden', '请先保存当前正式分供方及税号，再记录核验结果')
    const assertCurrent = () => {
      if (!isCurrent() || session.targetSupplierId !== target)
        throw new DOMException('税务核验页面已切换，请回原分供方恢复结果', 'AbortError')
    }
    session.taxpayerBusy = true
    let attempted = false
    try {
      const context = await repository().context()
      assertCurrent()
      if (!context.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
        throw credentialProblem('forbidden', '当前会话无分供方写入权限')
      const persistent = context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)
      if (session.persistent && !persistent)
        throw credentialProblem('forbidden', '正式税务核验权限已变化，请重新读取原提交。')
      const persistedKey = persistent ? supplierPendingKey(context, `taxpayer:${target}`) : ''
      const originalKey = persistedKey ? readSupplierPending(persistedKey) : null
      if (originalKey) {
        const resolved = await useNuxtApp().$repositories.supplierProduction.resolve(originalKey)
        assertCurrent()
        if (resolved.result) {
          const result = resolved.result
          if (!('verification' in result) || result.supplierId !== target)
            throw credentialProblem('relationship-mismatch', '原税务核验回执与当前分供方不一致。')
          await repository().loadForm(target)
          assertCurrent()
          clearSupplierPending(persistedKey, originalKey)
          session.pendingTaxpayerCommand = null
          latestWrite.value = { id: target, version: result.supplierVersion }
          return result
        }
        clearSupplierPending(persistedKey, originalKey)
        session.pendingTaxpayerCommand = null
      }
      const pending = session.pendingTaxpayerCommand
      if (pending && (pending.workspaceId !== context.workspaceId || pending.actorId !== context.actorId))
        throw credentialProblem('conflict', '核验提交的操作身份已变化，请重新核对当前资料')
      if (pending && JSON.stringify({ expectedTaxNo: pending.expectedTaxNo, draft: pending.draft }) !== JSON.stringify({ expectedTaxNo: input.expectedTaxNo, draft: input.draft }))
        throw credentialProblem('conflict', '请先恢复原核验提交，不能修改尚未确认的输入')
      const command: SupplierTaxpayerCommand = pending ?? { ...input, draft: structuredClone(input.draft), workspaceId: context.workspaceId, actorId: context.actorId, requiredCapability: SUPPLIER_WRITE_CAPABILITY, commandId: crypto.randomUUID(), baseSupplierVersion: version }
      session.pendingTaxpayerCommand = command
      if (persistedKey)
        rememberSupplierPending(persistedKey, command.commandId)
      attempted = true
      const result = await repository().recordTaxpayerVerification(command)
      assertCurrent()
      if (persistedKey)
        clearSupplierPending(persistedKey, command.commandId)
      session.pendingTaxpayerCommand = null
      // 核验重读可能已经见到别人的主档更正；不能替整页旧稿自动接受那些更正。
      if (session.baseVersion === command.baseSupplierVersion)
        session.baseVersion = result.supplierVersion
      latestWrite.value = { id: result.supplierId, version: result.supplierVersion }
      return result
    }
    catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) {
        const problem = supplierProblemFromUnknown(cause)
        if (attempted && !['unavailable', 'internal-error', 'forbidden'].includes(problem.problem.code))
          session.pendingTaxpayerCommand = null
      }
      throw cause
    }
    finally { session.taxpayerBusy = false }
  }

  async function pendingForms() {
    const context = await repository().context()
    if (!context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY))
      return []
    return [...new Set(supplierPendingTargets(context).flatMap((target) => {
      if (target === 'form:new')
        return ['/base/supplier/form']
      const match = /^(form|taxpayer|credential):([a-z0-9][\w-]{2,79})$/i.exec(target)
      if (!match)
        return []
      return [`/base/supplier/${match[1] === 'credential' ? 'credential' : 'form'}/${encodeURIComponent(match[2]!)}?origin=real`]
    }))]
  }

  return {
    latestWrite: readonly(latestWrite),
    createSession,
    hydrate,
    importRow,
    saveForm,
    startNewSupplier,
    rebase,
    acceptLatest,
    recordTaxpayerVerification,
    pendingForms,
  }
})
