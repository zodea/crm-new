import type { FormAttachmentChanges, MasterDataSaveAction, SupplierFormDraft } from '~/lib/master-data/forms'
import type { SupplierFormReadDTO } from '~/lib/supplier/command-contract'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { SUPPLIER_WRITE_CAPABILITY } from '~/lib/supplier/command-contract'
import { createSupplierRowImporter } from '~/lib/supplier/import-command'
import { supplierProblemFromUnknown } from '~/lib/supplier/repository'

export class SupplierCommandConflictError extends Error {
  constructor(public readonly latest: SupplierFormReadDTO) {
    super('分供方已有更新版本，请选择如何处理')
    this.name = 'SupplierCommandConflictError'
  }
}

export const useSupplierCommandStore = defineStore('supplier-command', () => {
  function createSession() {
    return { targetSupplierId: null as string | null, baseVersion: null as string | null, pendingCommand: null as { id: string, fingerprint: string } | null }
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
    session.targetSupplierId = id
    session.pendingCommand = null
    const form = id ? await repository().loadForm(id) : null
    session.baseVersion = form?.version ?? null
    return {
      draft: form?.draft ?? null,
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
    }
  }

  function startNewSupplier(session: CommandSession) {
    session.targetSupplierId = null
    session.baseVersion = null
    session.pendingCommand = null
  }

  function rebase(session: CommandSession, version: string) {
    session.baseVersion = version
  }

  function acceptLatest(session: CommandSession, latest: SupplierFormReadDTO) {
    session.targetSupplierId = latest.draft.id
    session.baseVersion = latest.version
  }

  async function saveForm(session: CommandSession, draft: SupplierFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    const id = session.targetSupplierId ?? draft.id ?? null
    const context = await repository().context()
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
      session.pendingCommand = null
      session.targetSupplierId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { id: result.id, logId: null, attachmentIds: result.attachmentIds }
    }
    catch (cause) {
      const problem = supplierProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && id)
        throw new SupplierCommandConflictError(await repository().loadForm(id))
      throw problem
    }
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
  }
})
