import type { FormAttachmentChanges, MasterDataSaveAction, SupplierFormDraft } from '~/lib/master-data/forms'
import type { SupplierCommandContextDTO, SupplierFormReadDTO } from '~/lib/supplier/command-contract'
import type { SupplierTaxpayerCommand, TaxpayerVerificationDraft } from '~/lib/supplier/taxpayer-verification'
import { defineStore } from 'pinia'
import { readonly, shallowReactive, shallowRef } from 'vue'
import { commandVersionAtLeast } from '~/lib/forms/command-recovery'
import { createFormCommandActions } from '~/lib/forms/command-session'
import { SUPPLIER_WRITE_CAPABILITY } from '~/lib/supplier/command-contract'
import { credentialProblem } from '~/lib/supplier/credential-contract'
import { createSupplierRowImporter, getSupplierImportSource } from '~/lib/supplier/import-command'
import { clearSupplierPending, readSupplierPending, rememberSupplierPending, SUPPLIER_PERSISTENT_CAPABILITY, supplierPendingKey, supplierPendingTargets } from '~/lib/supplier/pending'
import { supplierProblemFromUnknown } from '~/lib/supplier/repository'

export class SupplierCommandConflictError extends Error {
  constructor(public readonly latest: SupplierFormReadDTO, public readonly alreadyApplied = false) {
    super(alreadyApplied ? '上次分供方提交已保存，请先读取已保存内容；当前输入仍保留在页面。' : '分供方已有更新版本，请选择如何处理')
    this.name = 'SupplierCommandConflictError'
  }
}

export const useSupplierCommandStore = defineStore('supplier-command', () => {
  const repository = () => useNuxtApp().$repositories.supplierCommands
  const formal = createFormCommandActions<SupplierCommandContextDTO, typeof SUPPLIER_WRITE_CAPABILITY, SupplierFormDraft, MasterDataSaveAction, FormAttachmentChanges, SupplierFormReadDTO>({
    capability: SUPPLIER_WRITE_CAPABILITY,
    problemFromUnknown: supplierProblemFromUnknown,
    conflict: latest => new SupplierCommandConflictError(latest),
    repository: () => ({ ...repository(), context: async () => {
      const context = await repository().context()
      if (!context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY))
        throw credentialProblem('forbidden', '当前正式分供方权限或来源已变化，请保留原编号。')
      return context
    }, resolve: async (commandId) => {
      const resolved = await useNuxtApp().$repositories.supplierProduction.resolve(commandId)
      if (resolved.outcome === 'applied' && resolved.result && 'id' in resolved.result)
        return { outcome: 'applied' as const, result: resolved.result }
      if (resolved.outcome === 'not-applied' && resolved.commandId === commandId && resolved.result === null)
        return { outcome: 'not-applied' as const, commandId }
      throw credentialProblem('unavailable', '原分供方主档核对结果无效，请保留原编号。')
    } }),
    recoveryAdapter: {
      key: scope => supplierPendingKey(scope, `form:${scope.targetId ?? 'new'}`),
      read: (key, scope) => {
        const commandId = readSupplierPending(key)
        return commandId ? { ...scope, commandId, action: 'recover' } : null
      },
      remember: (key, descriptor) => rememberSupplierPending(key, descriptor.commandId),
      verify: (key, commandId) => {
        if (readSupplierPending(key) !== commandId)
          throw credentialProblem('conflict', '原分供方提交编号已变化，请重新核对。')
      },
      clear: clearSupplierPending,
    },
  })
  function createSession() {
    return shallowReactive({ targetSupplierId: null as string | null, baseVersion: null as string | null, pendingCommand: null as { id: string, fingerprint: string } | null, pendingTaxpayerCommand: null as SupplierTaxpayerCommand | null, taxpayerBusy: false, persistent: false, authority: null as Pick<SupplierCommandContextDTO, 'workspaceId' | 'actorId'> | null, loadGeneration: 0, formal: formal.createSession() })
  }
  type CommandSession = ReturnType<typeof createSession>

  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  let rowImporter: ReturnType<typeof createSupplierRowImporter> | null = null
  let importPending = new WeakMap<Record<string, unknown>, { key: string, commandId: string, workspaceId: string, actorId: string }>()
  const activeImportRows = new WeakSet<Record<string, unknown>>()
  let activeImportCount = 0
  let recoveringImports = false

  function resetImportCache() {
    rowImporter = null
    importPending = new WeakMap()
  }

  async function importRow(row: Record<string, unknown>) {
    if (recoveringImports || activeImportRows.has(row))
      throw credentialProblem('conflict', '该导入行正在保存，请等待当前结果。')
    activeImportRows.add(row)
    activeImportCount++
    rowImporter ??= createSupplierRowImporter(repository(), { onPrepared: async (request, sourceRow, persistent) => {
      const context = await repository().context()
      if (context.workspaceId !== request.workspaceId || context.actorId !== request.actorId || !context.capabilities.includes(SUPPLIER_WRITE_CAPABILITY) || context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY) !== persistent)
        throw credentialProblem('forbidden', '导入期间身份或权限变化，请重新预览。')
      if (!context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY))
        return
      const source = getSupplierImportSource(sourceRow)
      if (!source || !/^import:[a-f0-9]{64}$/.test(source))
        throw credentialProblem('validation-failed', '缺少导入来源，请重新选择文件。')
      const key = supplierPendingKey(context, source)
      rememberSupplierPending(key, request.commandId)
      importPending.set(sourceRow, { key, commandId: request.commandId, workspaceId: context.workspaceId, actorId: context.actorId })
    } })
    try {
      const result = await rowImporter(row)
      const pending = importPending.get(row)
      if (pending) {
        const current = await repository().context()
        if (current.workspaceId !== pending.workspaceId || current.actorId !== pending.actorId || !current.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY) || !current.capabilities.includes(SUPPLIER_WRITE_CAPABILITY) || result.commandId !== pending.commandId)
          throw credentialProblem('forbidden', '导入后身份、权限或原编号变化，请保留原提交。')
        clearSupplierPending(pending.key, pending.commandId)
        importPending.delete(row)
      }
      // 导入回读后通知缓存页面；不改变正在编辑的目标、版本或待重试保存命令。
      latestWrite.value = { id: result.id, version: result.version }
      return result
    }
    finally {
      activeImportRows.delete(row)
      activeImportCount--
    }
  }

  /** 只保存原提交号；重进导入前先核对同工作区全部未决行，不保存表格正文。 */
  async function recoverPendingImports() {
    if (activeImportCount || recoveringImports)
      throw credentialProblem('conflict', '已有分供方导入正在保存，请等待当前结果。')
    recoveringImports = true
    try {
      const context = await repository().context()
      if (!context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)) {
        resetImportCache()
        return { applied: 0, notApplied: 0 }
      }
      if (!context.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
        throw credentialProblem('forbidden', '无分供方导入权限，不能核对原提交。')
      let applied = 0
      let notApplied = 0
      const targets = supplierPendingTargets(context).filter(value => value.startsWith('import:'))
      if (targets.some(value => !/^import:[a-f0-9]{64}$/.test(value)))
        throw credentialProblem('unavailable', '原导入标识损坏，请保留当前资料并核对恢复信息。')
      for (const target of targets) {
        const key = supplierPendingKey(context, target)
        const commandId = readSupplierPending(key)
        if (!commandId)
          continue
        const resolved = await useNuxtApp().$repositories.supplierProduction.resolve(commandId)
        if (resolved.outcome === 'applied') {
          if (!('id' in resolved.result) || resolved.result.commandId !== commandId)
            throw credentialProblem('relationship-mismatch', '原导入回执类型或编号不一致，请停止恢复。')
          const form = await repository().loadForm(resolved.result.id)
          if (form.draft.id !== resolved.result.id || !commandVersionAtLeast(form.version, resolved.result.version))
            throw credentialProblem('unavailable', '原导入已保存，但同一主档尚未可靠读取。')
          latestWrite.value = { id: resolved.result.id, version: form.version }
          applied++
        }
        else { notApplied++ }
        const current = await repository().context()
        if (current.workspaceId !== context.workspaceId || current.actorId !== context.actorId || !current.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY) || !current.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
          throw credentialProblem('forbidden', '核对期间身份或权限变化，请保留原编号。')
        clearSupplierPending(key, commandId)
      }
      resetImportCache()
      return { applied, notApplied }
    }
    finally {
      recoveringImports = false
    }
  }

  async function hydrate(session: CommandSession, id: string | null) {
    const ticket = ++session.loadGeneration
    let formalGeneration = ++session.formal.generation
    const assertCurrent = () => {
      if (session.loadGeneration !== ticket || session.formal.generation !== formalGeneration)
        throw new DOMException('此读取不属于当前分供方页面。', 'AbortError')
    }
    const context = await repository().context()
    assertCurrent()
    session.persistent = context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)
    let read
    if (session.persistent) {
      const loading = formal.hydrate(session.formal, id)
      formalGeneration = session.formal.generation
      read = await loading
    }
    else {
      read = { form: id ? await repository().loadForm(id) : null, recovered: false, recoveryOutcome: null }
    }
    assertCurrent()
    id = read.form?.draft.id ?? id
    let form = read.form
    let productionNotice = read.recoveryOutcome === 'applied' ? '已核对上次提交：保存成功，现已读取磁盘中的分供方。' : read.recovered ? '已核对上次提交：没有保存，迟到请求已封存。刷新前的未保存输入需重新填写。' : ''
    if (session.persistent && id) {
      const key = supplierPendingKey(context, `taxpayer:${id}`)
      const commandId = readSupplierPending(key)
      if (commandId) {
        const resolved = await useNuxtApp().$repositories.supplierProduction.resolve(commandId)
        assertCurrent()
        if (resolved.outcome === 'applied') {
          if (!('verification' in resolved.result) || resolved.result.supplierId !== id)
            throw credentialProblem('relationship-mismatch', '原税务核验与当前分供方不一致，停止恢复。')
          form = await repository().loadForm(id)
          assertCurrent()
          if (form.draft.id !== id || !commandVersionAtLeast(form.version, resolved.result.supplierVersion))
            throw credentialProblem('unavailable', '原税务核验已保存，当前同一主档尚未可靠读取。')
          productionNotice = '已核对上次税务核验：已读取同一分供方的保存结果。'
        }
        const current = await repository().context()
        assertCurrent()
        if (current.workspaceId !== context.workspaceId || current.actorId !== context.actorId || !current.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY))
          throw credentialProblem('forbidden', '恢复期间当前身份或正式权限已变化，请保留原编号。')
        clearSupplierPending(key, commandId)
      }
    }
    session.targetSupplierId = id
    session.authority = { workspaceId: context.workspaceId, actorId: context.actorId }
    session.pendingCommand = null
    session.pendingTaxpayerCommand = null
    session.taxpayerBusy = false
    session.baseVersion = form?.version ?? null
    if (session.persistent)
      session.formal.baseVersion = session.baseVersion
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
    if (session.taxpayerBusy || session.pendingTaxpayerCommand)
      throw credentialProblem('conflict', '请先核对原税务核验，再新建分供方。')
    if (session.persistent)
      formal.startNew(session.formal)
    session.targetSupplierId = null
    session.baseVersion = null
    session.pendingCommand = null
    session.pendingTaxpayerCommand = null
  }

  function rebase(session: CommandSession, version: string) {
    if (session.persistent) {
      if (session.formal.pending)
        throw credentialProblem('conflict', '请先核对原提交，再接受更新版本。')
      session.formal.baseVersion = version
    }
    session.baseVersion = version
  }

  function acceptLatest(session: CommandSession, latest: SupplierFormReadDTO) {
    if (session.persistent)
      formal.adoptConflictVersion(session.formal, latest)
    session.targetSupplierId = latest.draft.id
    session.baseVersion = latest.version
  }

  async function saveForm(session: CommandSession, draft: SupplierFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    if (session.taxpayerBusy || session.pendingTaxpayerCommand)
      throw credentialProblem('conflict', '请先恢复并确认尚未完成的税务核验提交')
    if (session.persistent) {
      const context = session.formal.context
      if (context && session.targetSupplierId && readSupplierPending(supplierPendingKey(context, `taxpayer:${session.targetSupplierId}`)))
        throw credentialProblem('conflict', '请先恢复原税务核验，再保存主档。')
      const result = await formal.saveForm(session.formal, draft, action, attachments)
      session.targetSupplierId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { ...result, logId: null }
    }
    const id = session.targetSupplierId ?? draft.id ?? null
    const generation = session.loadGeneration
    const target = session.targetSupplierId
    const baseVersion = session.baseVersion
    const assertCurrent = () => {
      if (session.loadGeneration !== generation || session.targetSupplierId !== target || session.baseVersion !== baseVersion)
        throw new DOMException('此保存不属于当前分供方页面。', 'AbortError')
    }
    const context = await repository().context()
    assertCurrent()
    if (!context.capabilities.includes(SUPPLIER_WRITE_CAPABILITY)
      || (session.authority && (context.workspaceId !== session.authority.workspaceId || context.actorId !== session.authority.actorId))) {
      throw credentialProblem('forbidden', '当前身份或分供方写入权限已变化，请保留输入。')
    }
    const persistent = context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)
    if (persistent)
      throw credentialProblem('forbidden', '请先重新读取正式分供方表单，再保存。')
    const attachmentChanges: FormAttachmentChanges = {
      ...(attachments.add?.length ? { add: attachments.add } : {}),
      ...(attachments.removeIds?.length ? { removeIds: attachments.removeIds } : {}),
      ...(attachments.restoreIds?.length ? { restoreIds: attachments.restoreIds } : {}),
    }
    const content = { id, baseVersion: session.baseVersion, action, draft: { ...draft, ...(id ? { id } : {}) }, attachments: attachmentChanges }
    const fingerprint = JSON.stringify(content)
    if (session.pendingCommand && session.pendingCommand.fingerprint !== fingerprint)
      throw credentialProblem('conflict', '原提交结果未知，当前输入不能替换原命令。')
    session.pendingCommand ??= { id: crypto.randomUUID(), fingerprint }
    const command = session.pendingCommand
    try {
      const result = await repository().execute({
        ...(id ? { id } : {}),
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        requiredCapability: SUPPLIER_WRITE_CAPABILITY,
        commandId: command.id,
        baseVersion: session.baseVersion,
        action,
        draft: content.draft,
        attachments: attachmentChanges,
      })
      assertCurrent()
      if (result.commandId !== command.id || (id && result.id !== id))
        throw credentialProblem('unavailable', '分供方回执与原提交不一致，请核对原编号。')
      const current = await repository().context()
      assertCurrent()
      if (current.workspaceId !== context.workspaceId || current.actorId !== context.actorId || !current.capabilities.includes(SUPPLIER_WRITE_CAPABILITY) || current.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY))
        throw credentialProblem('forbidden', '保存期间身份、权限或来源变化，请保留原提交。')
      session.pendingCommand = null
      session.targetSupplierId = result.id
      session.baseVersion = result.version
      latestWrite.value = { id: result.id, version: result.version }
      return { id: result.id, logId: null, attachmentIds: result.attachmentIds }
    }
    catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError')
        throw cause
      const problem = supplierProblemFromUnknown(cause)
      if (session.pendingCommand === command && !['unavailable', 'internal-error', 'forbidden', 'unauthenticated'].includes(problem.problem.code))
        session.pendingCommand = null
      if (problem.problem.code === 'conflict' && id) {
        const latest = await repository().loadForm(id)
        assertCurrent()
        throw new SupplierCommandConflictError(latest)
      }
      throw problem
    }
  }

  async function recordTaxpayerVerification(session: CommandSession, input: { supplierId: string, origin: 'real' | 'demo', expectedTaxNo: string, baseSupplierVersion: string, draft: TaxpayerVerificationDraft }, isCurrent: () => boolean = () => true) {
    if (session.taxpayerBusy || session.pendingCommand || session.formal.pending || session.formal.busy)
      throw credentialProblem('conflict', '请先确认当前主档保存结果，再记录税务核验')
    const target = session.targetSupplierId
    const ticket = session.loadGeneration
    const formalGeneration = session.formal.generation
    const version = input.baseSupplierVersion
    if (input.origin !== 'real' || !target || target !== input.supplierId || !version || !input.expectedTaxNo.trim())
      throw credentialProblem('forbidden', '请先保存当前正式分供方及税号，再记录核验结果')
    const assertCurrent = () => {
      if (!isCurrent() || session.targetSupplierId !== target || session.loadGeneration !== ticket || session.formal.generation !== formalGeneration)
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
      if (persistent && session.formal.context && (session.formal.context.workspaceId !== context.workspaceId || session.formal.context.actorId !== context.actorId))
        throw credentialProblem('forbidden', '表单所属身份已变化，请重新读取当前分供方，再记录核验。')
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
          const form = await repository().loadForm(target)
          if (form.draft.id !== target || !commandVersionAtLeast(form.version, result.supplierVersion))
            throw credentialProblem('unavailable', '原税务核验已保存，仍需读取同一主档。')
          assertCurrent()
          const current = await repository().context()
          assertCurrent()
          if (current.workspaceId !== context.workspaceId || current.actorId !== context.actorId || !current.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY) || !current.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
            throw credentialProblem('forbidden', '核验恢复期间身份或正式权限已变化，请保留原编号。')
          clearSupplierPending(persistedKey, originalKey)
          const originalBase = session.pendingTaxpayerCommand?.baseSupplierVersion
          if (originalBase && session.baseVersion === originalBase)
            session.baseVersion = result.supplierVersion
          if (originalBase && session.formal.baseVersion === originalBase)
            session.formal.baseVersion = result.supplierVersion
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
      if (persistent) {
        const form = await repository().loadForm(target)
        const current = await repository().context()
        assertCurrent()
        if (form.draft.id !== target || !commandVersionAtLeast(form.version, result.supplierVersion))
          throw credentialProblem('unavailable', '税务核验已保存待刷新，请只恢复原核验读取。')
        if (current.workspaceId !== context.workspaceId || current.actorId !== context.actorId || !current.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY) || !current.capabilities.includes(SUPPLIER_WRITE_CAPABILITY))
          throw credentialProblem('forbidden', '保存后身份或正式权限已变化，请保留原核验编号。')
      }
      if (persistedKey)
        clearSupplierPending(persistedKey, command.commandId)
      session.pendingTaxpayerCommand = null
      // 核验重读可能已经见到别人的主档更正；不能替整页旧稿自动接受那些更正。
      if (session.baseVersion === command.baseSupplierVersion)
        session.baseVersion = result.supplierVersion
      if (persistent && session.formal.baseVersion === command.baseSupplierVersion)
        session.formal.baseVersion = result.supplierVersion
      latestWrite.value = { id: result.supplierId, version: result.supplierVersion }
      return result
    }
    catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) {
        const problem = supplierProblemFromUnknown(cause)
        if (attempted && !['unavailable', 'internal-error', 'forbidden', 'unauthenticated'].includes(problem.problem.code))
          session.pendingTaxpayerCommand = null
      }
      throw cause
    }
    finally {
      if (session.loadGeneration === ticket && session.formal.generation === formalGeneration)
        session.taxpayerBusy = false
    }
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

  async function recover(session: CommandSession) {
    const resolved = await formal.recover(session.formal)
    session.targetSupplierId = session.formal.targetId
    session.baseVersion = session.formal.baseVersion
    if (resolved.outcome === 'applied')
      latestWrite.value = { id: resolved.result.id, version: resolved.result.version }
    return resolved
  }

  async function revalidate(session: CommandSession) {
    if (session.persistent)
      return formal.revalidate(session.formal)
    const generation = ++session.loadGeneration
    const target = session.targetSupplierId
    const authority = session.authority
    const assertCurrent = () => {
      if (session.loadGeneration !== generation || session.targetSupplierId !== target)
        throw new DOMException('此复验不属于当前分供方页面。', 'AbortError')
    }
    const assertContext = (context: SupplierCommandContextDTO) => {
      assertCurrent()
      if (!authority || context.workspaceId !== authority.workspaceId || context.actorId !== authority.actorId
        || !context.capabilities.includes(SUPPLIER_WRITE_CAPABILITY) || context.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)) {
        throw credentialProblem('forbidden', '当前身份、写入权限或运行来源与原编辑页不一致，请保留输入。')
      }
    }
    assertContext(await repository().context())
    const form = target ? await repository().loadForm(target) : null
    assertCurrent()
    if (form && (form.draft.id !== target || !commandVersionAtLeast(form.version, form.version)))
      throw credentialProblem('relationship-mismatch', '分供方复验与原编辑目标不一致，请保留输入。')
    const context = await repository().context()
    assertContext(context)
    return { form, context }
  }

  function deactivate(session: CommandSession) {
    ++session.loadGeneration
    formal.invalidate(session.formal)
    session.taxpayerBusy = false
  }

  return {
    latestWrite: readonly(latestWrite),
    createSession,
    hydrate,
    importRow,
    recoverPendingImports,
    saveForm,
    recover,
    revalidate,
    deactivate,
    startNewSupplier,
    rebase,
    acceptLatest,
    recordTaxpayerVerification,
    pendingForms,
  }
})
