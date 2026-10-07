import type { CommandRecoveryDescriptor, CommandResolution, RecoveryStorage } from './command-recovery'
import { readonly, shallowReactive, shallowRef } from 'vue'
import { commandRecoveryKey, commandVersionAtLeast, createCommandRecoveryStorage } from './command-recovery'

interface CommandContext { workspaceId: string, actorId: string, capabilities: readonly string[] }
export interface CommandFormRead<D> { draft: D & { id: string }, attachments: unknown[], version: string, updatedAt: string }
interface CommandResult { id: string, commandId: string, version: string, updatedAt: string, attachmentIds: string[] }
interface CommandContent<D, A extends string, Files> { id?: string, baseVersion: string | null, action: A, draft: D, attachments: Files }
interface PendingCommand { id: string, fingerprint: string | null, descriptor: CommandRecoveryDescriptor, result: CommandResult | null }
interface FormSession<C> {
  targetId: string | null
  baseVersion: string | null
  context: C | null
  authority: Pick<CommandContext, 'workspaceId' | 'actorId'> | null
  generation: number
  busy: boolean
  pendingKey: string
  pending: PendingCommand | null
}

export interface FormRecoveryAdapter {
  key: typeof commandRecoveryKey
  read: (key: string, scope: Pick<CommandRecoveryDescriptor, 'workspaceId' | 'actorId' | 'family' | 'targetId'>) => CommandRecoveryDescriptor | null
  remember: (key: string, descriptor: CommandRecoveryDescriptor) => void
  verify: (key: string, commandId: string) => void
  clear: (key: string, commandId: string) => void
}

/** The form owns its target and input. A receipt confirms a write; a subsequent authorized read confirms cleanup. */
export function createFormCommandActions<C extends CommandContext, Capability extends string, D extends { id?: string }, A extends string, Files, Read extends CommandFormRead<D>, Extra extends object = object>(options: {
  repository: () => {
    context: () => Promise<C>
    loadForm: (id: string) => Promise<Read>
    execute: (request: CommandContent<D, A, Files> & Extra & { workspaceId: string, actorId: string, requiredCapability: Capability, commandId: string }) => Promise<CommandResult>
    resolve: (commandId: string) => Promise<CommandResolution<CommandResult>>
  }
  capability: Capability
  problemFromUnknown: (cause: unknown) => Error & { problem: { code: string } }
  conflict: (latest: Read) => Error
  validateReadContext?: (form: Read, context: C) => void
  versionAtLeast?: (current: string, original: string, evidence: { result?: CommandResult, form?: Read }) => boolean
  recoveryStorage?: () => RecoveryStorage
  recoveryAdapter?: FormRecoveryAdapter
}) {
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const recovery = options.recoveryAdapter ?? createCommandRecoveryStorage(options.recoveryStorage)
  const recoveryKey = options.recoveryAdapter?.key ?? commandRecoveryKey
  const family = options.capability.split(':')[0]!
  function versionAtLeast(current: string, original: string, evidence: { result?: CommandResult, form?: Read }) {
    return options.versionAtLeast ? options.versionAtLeast(current, original, evidence) : commandVersionAtLeast(current, original)
  }
  function createSession(): FormSession<C> {
    return shallowReactive({ targetId: null, baseVersion: null, context: null, authority: null, generation: 0, busy: false, pendingKey: '', pending: null })
  }
  function requireSameContext(context: C, original: Pick<CommandContext, 'workspaceId' | 'actorId'>) {
    if (context.workspaceId !== original.workspaceId || context.actorId !== original.actorId || !context.capabilities.includes(options.capability))
      throw new Error('当前身份或权限已变化，请恢复原会话后核对原提交。')
  }
  async function authorizedContext(session: FormSession<C>, original: Pick<CommandContext, 'workspaceId' | 'actorId'>, generation: number) {
    try {
      const context = await options.repository().context()
      if (session.generation !== generation)
        throw new Error('页面目标已变化，请回原页面核对。')
      requireSameContext(context, original)
      return context
    }
    catch (cause) {
      if (session.generation === generation)
        session.context = null
      throw cause
    }
  }
  function assertResult(result: CommandResult, pending: PendingCommand) {
    if (!result || result.commandId !== pending.id || !result.id || (pending.descriptor.targetId && result.id !== pending.descriptor.targetId)
      || !versionAtLeast(result.version, result.version, { result }) || !Number.isFinite(Date.parse(result.updatedAt))
      || !Array.isArray(result.attachmentIds) || result.attachmentIds.some(id => typeof id !== 'string' || !id)
      || new Set(result.attachmentIds).size !== result.attachmentIds.length) {
      throw new Error('原提交回执与当前目标不一致，请保留原编号。')
    }
  }
  async function readApplied(session: FormSession<C>, pending: PendingCommand, generation: number) {
    const result = pending.result!
    assertResult(result, pending)
    let form: Read
    try {
      form = await options.repository().loadForm(result.id)
    }
    catch (cause) {
      if (session.generation === generation && ['forbidden', 'unauthenticated'].includes(options.problemFromUnknown(cause).problem.code))
        session.context = null
      throw cause
    }
    const context = await authorizedContext(session, pending.descriptor, generation)
    options.validateReadContext?.(form, context)
    if (form.draft.id !== result.id || !versionAtLeast(form.version, result.version, { result, form }))
      throw new Error('已保存的同一记录尚未可靠读取，请只重试读取。')
    if (session.generation !== generation || session.pending?.id !== pending.id)
      throw new Error('原提交已保存，当前页面目标已变化，请回原页面核对。')
    recovery.clear(session.pendingKey, pending.id)
    session.context = context
    session.authority = { workspaceId: context.workspaceId, actorId: context.actorId }
    session.targetId = result.id
    session.baseVersion = result.version
    session.pending = null
    return { form, context }
  }
  async function hydrate(session: FormSession<C>, id: string | null) {
    if (session.busy)
      throw new Error('原提交仍在处理中，请等待当前结果。')
    const generation = ++session.generation
    const context = await options.repository().context()
    const key = recoveryKey({ ...context, family, targetId: id })
    const descriptor = recovery.read(key, { ...context, family, targetId: id })
    if (session.generation !== generation)
      throw new Error('此读取不属于当前记录页面。')
    session.pendingKey = key
    let recovered = false
    if (descriptor) {
      requireSameContext(context, descriptor)
      session.pendingKey = key
      session.pending = { id: descriptor.commandId, descriptor, fingerprint: null, result: null }
      const resolution = await options.repository().resolve(descriptor.commandId)
      if (session.generation !== generation)
        throw new Error('此读取不属于当前记录页面。')
      if (resolution.outcome === 'applied') {
        session.pending = { ...session.pending, result: resolution.result }
        const read = await readApplied(session, session.pending, generation)
        return { ...read, recovered: true, recoveryOutcome: 'applied' as const }
      }
      if (resolution.commandId !== descriptor.commandId)
        throw new Error('原编号封存结果不一致，请保留原编号。')
      await authorizedContext(session, descriptor, generation)
      recovery.clear(key, descriptor.commandId)
      session.pending = null
      recovered = true
    }
    const form = id ? await options.repository().loadForm(id) : null
    const current = await authorizedContext(session, context, generation)
    if (form)
      options.validateReadContext?.(form, current)
    if (form && form.draft.id !== id)
      throw new Error('读取的记录与当前目标不一致。')
    if (session.generation !== generation)
      throw new Error('此读取不属于当前记录页面。')
    session.targetId = id
    session.baseVersion = form?.version ?? null
    session.context = current
    session.authority = { workspaceId: current.workspaceId, actorId: current.actorId }
    session.pendingKey = key
    session.pending = null
    return { form, context: current, recovered, recoveryOutcome: recovered ? 'not-applied' as const : null }
  }

  /** Reopening a retained editing instance checks authority and existence without adopting a later baseline. */
  async function revalidate(session: FormSession<C>) {
    if (session.pending || session.busy)
      throw new Error('请先核对原提交，再继续编辑。')
    if (!session.authority)
      throw new Error('原编辑会话身份未建立，请重新进入。')
    const generation = session.generation
    const authority = session.authority
    const targetId = session.targetId
    session.context = null
    const context = await authorizedContext(session, authority, generation)
    const form = targetId ? await options.repository().loadForm(targetId) : null
    const current = await authorizedContext(session, authority, generation)
    if (form)
      options.validateReadContext?.(form, current)
    if (form && (form.draft.id !== targetId || !versionAtLeast(form.version, form.version, { form })))
      throw new Error('重新读取与原编辑目标不一致，请保留输入。')
    if (session.generation !== generation || session.targetId !== targetId)
      throw new Error('页面目标已变化，请保留原编辑基准。')
    session.context = current
    return { form, context }
  }
  async function recover(session: FormSession<C>) {
    const pending = session.pending
    if (!pending || session.busy)
      throw new Error('请先等待原提交结果。')
    session.busy = true
    const generation = session.generation
    try {
      recovery.verify(session.pendingKey, pending.id)
      await authorizedContext(session, pending.descriptor, generation)
      let saved = pending
      if (!saved.result) {
        const resolved = await options.repository().resolve(saved.id)
        if (resolved.outcome === 'not-applied') {
          if (resolved.commandId !== saved.id)
            throw new Error('原编号封存结果不一致。')
          if (session.generation !== generation)
            throw new Error('页面目标已变化，请回原页面核对。')
          await authorizedContext(session, saved.descriptor, generation)
          recovery.clear(session.pendingKey, saved.id)
          session.pending = null
          if (!session.context) {
            const retainedBaseVersion = session.baseVersion
            session.busy = false
            const read = await hydrate(session, saved.descriptor.targetId)
            if (retainedBaseVersion !== null)
              session.baseVersion = retainedBaseVersion
            return { outcome: 'not-applied' as const, ...read }
          }
          return { outcome: 'not-applied' as const, form: null, context: session.context }
        }
        saved = { ...saved, result: resolved.result }
        if (session.generation === generation)
          session.pending = saved
      }
      const read = await readApplied(session, saved, generation)
      return { outcome: 'applied' as const, result: saved.result!, ...read }
    }
    finally {
      if (session.generation === generation)
        session.busy = false
    }
  }
  async function saveForm(session: FormSession<C>, draft: D, action: A, attachments: Files = {} as Files, extra?: Extra) {
    if (!session.context || (draft.id && draft.id !== session.targetId))
      throw new Error('当前表单与写入目标不一致，请重新载入后保存。')
    if (session.busy)
      throw new Error('记录正在保存，请等待当前结果。')
    if (session.pending)
      throw new Error(session.pending.result ? '记录已保存待刷新，请只核对原提交，不要再次保存。' : '原提交结果未知，请先核对原编号，再提交新的内容。')
    const generation = session.generation
    const id = session.targetId
    const originalContext = session.context
    const content: CommandContent<D, A, Files> & Extra = JSON.parse(JSON.stringify({ ...extra, ...(id ? { id } : {}), baseVersion: session.baseVersion, action, draft: { ...draft, ...(id ? { id } : {}) }, attachments }))
    const fingerprint = JSON.stringify(content)
    const commandId = crypto.randomUUID()
    const descriptor = { commandId, workspaceId: originalContext.workspaceId, actorId: originalContext.actorId, family, targetId: id, action }
    session.pendingKey = recoveryKey(descriptor)
    recovery.remember(session.pendingKey, descriptor)
    const pending: PendingCommand = { id: commandId, fingerprint, descriptor, result: null }
    session.pending = pending
    session.busy = true
    try {
      await authorizedContext(session, originalContext, generation)
      if (session.pending?.id !== pending.id)
        throw new Error('原提交编号已变化，请回原页面核对。')
      const result = await options.repository().execute({ ...content, workspaceId: originalContext.workspaceId, actorId: originalContext.actorId, requiredCapability: options.capability, commandId })
      assertResult(result, pending)
      const saved = { ...pending, result }
      if (session.generation === generation)
        session.pending = saved
      if (session.generation === generation)
        latestWrite.value = { id: result.id, version: result.version }
      const read = await readApplied(session, saved, generation)
      const retainedInput = JSON.stringify({ ...extra, ...(id ? { id } : {}), baseVersion: content.baseVersion, action, draft: { ...draft, ...(id ? { id } : {}) }, attachments }) !== fingerprint
      return { ...result, form: read.form, readbackConfirmed: true as const, retainedInput }
    }
    catch (cause) {
      if (session.generation !== generation)
        throw new Error('原提交结果仍需核对，请回原页面恢复原编号。', { cause })
      if (session.pending?.result)
        throw new Error('记录已保存待刷新；请保留输入并只重试原目标读取。', { cause })
      const problem = options.problemFromUnknown(cause)
      if (['conflict', 'validation-failed', 'relationship-mismatch', 'not-found', 'stale-source'].includes(problem.problem.code)) {
        try {
          const resolution = await options.repository().resolve(commandId)
          if (resolution.outcome === 'not-applied' && resolution.commandId === commandId && session.generation === generation) {
            await authorizedContext(session, originalContext, generation)
            recovery.clear(session.pendingKey, commandId)
            session.pending = null
          }
          else if (resolution.outcome === 'applied' && session.generation === generation) {
            assertResult(resolution.result, pending)
            session.pending = { ...pending, result: resolution.result }
          }
        }
        catch { /* Failure to resolve keeps the original key; no new write is allowed. */ }
      }
      if (session.generation !== generation)
        throw new Error('页面目标已变化，请回原页面核对原提交。', { cause })
      if (session.pending?.result)
        throw new Error('记录已保存待刷新；请保留输入并只重试原目标读取。', { cause })
      if (problem.problem.code === 'conflict' && id) {
        const latest = await options.repository().loadForm(id).catch(() => null)
        const current = await authorizedContext(session, originalContext, generation)
        if (latest)
          options.validateReadContext?.(latest, current)
        if (latest && latest.draft.id === session.targetId && latest.draft.id === id && versionAtLeast(latest.version, latest.version, { form: latest }))
          throw options.conflict(latest)
      }
      throw problem
    }
    finally {
      if (session.generation === generation)
        session.busy = false
    }
  }
  function adoptConflictVersion(session: FormSession<C>, latest: Read) {
    if (session.pending)
      throw new Error('请先核对原提交，再采用新的记录版本。')
    if (latest.draft.id !== session.targetId)
      throw new Error('更新版本不属于当前记录，请重新载入。')
    if (options.validateReadContext) {
      if (!session.context)
        throw new Error('原编辑会话权限尚未重新核实，请保留原版本。')
      options.validateReadContext(latest, session.context)
    }
    session.baseVersion = latest.version
  }
  function startNew(session: FormSession<C>) {
    if (session.pending || session.busy)
      throw new Error('请先核对原提交，再新建另一条记录。')
    session.generation++
    session.targetId = null
    session.baseVersion = null
    if (session.context)
      session.pendingKey = recoveryKey({ ...session.context, family, targetId: null })
  }
  function invalidate(session: FormSession<C>) {
    session.generation++
    session.context = null
    session.busy = false
  }
  return { latestWrite: readonly(latestWrite), createSession, hydrate, revalidate, saveForm, recover, adoptConflictVersion, startNew, invalidate }
}
