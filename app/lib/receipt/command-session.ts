import type { CommandRecoveryDescriptor, RecoveryStorage } from '../forms/command-recovery'
import type { FileRefChanges } from '../forms/file-refs'
import type { ReceiptAction, ReceiptCommand, ReceiptCommandResult, ReceiptContext, ReceiptDetail, ReceiptDraft } from './contract'
import type { ReceiptRepository } from './repository'
import { readonly, shallowRef } from 'vue'
import { commandRecoveryKey, commandVersionAtLeast, createCommandRecoveryStorage } from '../forms/command-recovery'
import { RECEIPT_WRITE_CAPABILITY, receiptProblem, ReceiptRepositoryProblem } from './contract'
import { receiptProblemFromUnknown } from './repository'

interface PendingReceipt {
  id: string
  fingerprint: string | null
  descriptor: CommandRecoveryDescriptor
  result: ReceiptCommandResult | null
}
export interface ReceiptFormSession {
  targetId: string | null
  baseVersion: string | null
  context: ReceiptContext | null
  generation: number
  canWrite: boolean
  busy: boolean
  pendingKey: string
  pending: PendingReceipt | null
}

export class ReceiptCommandConflict extends ReceiptRepositoryProblem {
  constructor(problem: ReceiptRepositoryProblem['problem'], readonly latest: ReceiptDetail | null) {
    super(problem)
    this.name = 'ReceiptCommandConflict'
  }
}

export function createReceiptCommandActions(repository: () => Pick<ReceiptRepository, 'context' | 'detail' | 'execute' | 'resolve'>, storage?: () => RecoveryStorage) {
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)
  const recovery = createCommandRecoveryStorage(storage)
  function createSession(): ReceiptFormSession {
    return { targetId: null, baseVersion: null, context: null, generation: 0, canWrite: false, busy: false, pendingKey: '', pending: null }
  }
  async function readCurrent(id: string | null) {
    const context = await repository().context()
    const detail = id ? await repository().detail(id, { origin: 'real' }) : null
    const after = await repository().context()
    if (after.workspaceId !== context.workspaceId || after.actorId !== context.actorId)
      throw receiptProblem('forbidden', '读取期间身份已变化，请重新读取')
    if (detail && (detail.record.id !== id || detail.record.dataOrigin !== 'real'))
      throw receiptProblem('relationship-mismatch', '读取的收款与当前目标不一致')
    const canWrite = after.capabilities.includes(RECEIPT_WRITE_CAPABILITY) && (!detail || detail.capabilities.includes(RECEIPT_WRITE_CAPABILITY))
    return { context: after, detail, canWrite }
  }
  function checkContext(context: ReceiptContext, original: CommandRecoveryDescriptor) {
    if (context.workspaceId !== original.workspaceId || context.actorId !== original.actorId || !context.capabilities.includes(RECEIPT_WRITE_CAPABILITY))
      throw receiptProblem('forbidden', '当前身份或权限已变化，请恢复原会话后核对原提交')
  }
  function checkResult(result: ReceiptCommandResult, pending: PendingReceipt) {
    if (!result || result.commandId !== pending.id || !result.id || (pending.descriptor.targetId && result.id !== pending.descriptor.targetId)
      || !commandVersionAtLeast(result.version, result.version) || !Number.isFinite(Date.parse(result.updatedAt))
      || !Array.isArray(result.attachmentIds) || result.attachmentIds.some(id => typeof id !== 'string' || !id)
      || new Set(result.attachmentIds).size !== result.attachmentIds.length) {
      throw receiptProblem('internal-error', '原收款回执与目标不一致，请保留原编号')
    }
  }
  async function readApplied(session: ReceiptFormSession, pending: PendingReceipt, generation: number) {
    const result = pending.result!
    checkResult(result, pending)
    const value = await readCurrent(result.id)
    checkContext(value.context, pending.descriptor)
    if (!value.detail || value.detail.record.id !== result.id || value.detail.record.dataOrigin !== 'real' || !commandVersionAtLeast(value.detail.record.version, result.version))
      throw receiptProblem('unavailable', '已保存的同一收款尚未可靠读回，请只重试读取', {}, true)
    if (generation !== session.generation || session.pending?.id !== pending.id)
      throw receiptProblem('conflict', '原收款已保存，当前页面目标已变化，请回原页面核对')
    recovery.clear(session.pendingKey, pending.id)
    session.targetId = result.id
    session.baseVersion = result.version
    session.context = value.context
    session.canWrite = value.canWrite
    session.pending = null
    return value
  }
  async function hydrate(session: ReceiptFormSession, id: string | null) {
    const generation = ++session.generation
    session.canWrite = false
    session.busy = false
    try {
      const context = await repository().context()
      const key = commandRecoveryKey({ ...context, family: 'receipt', targetId: id })
      const descriptor = recovery.read(key)
      if (generation !== session.generation)
        return null
      session.pendingKey = key
      if (descriptor) {
        checkContext(context, descriptor)
        session.pending = { id: descriptor.commandId, fingerprint: null, descriptor, result: null }
        const resolved = await repository().resolve(descriptor.commandId)
        if (generation !== session.generation)
          return null
        if (resolved.outcome === 'applied') {
          session.pending = { ...session.pending, result: resolved.result }
          const value = await readApplied(session, session.pending, generation)
          return { context: value.context, detail: value.detail, recovered: true }
        }
        if (resolved.commandId !== descriptor.commandId)
          throw receiptProblem('internal-error', '原编号封存结果不一致')
        recovery.clear(key, descriptor.commandId)
      }
      const value = await readCurrent(id)
      if (generation !== session.generation)
        return null
      session.targetId = id
      session.baseVersion = value.detail?.record.version ?? null
      session.context = value.context
      session.canWrite = value.canWrite
      session.pending = null
      return { context: value.context, detail: value.detail, recovered: Boolean(descriptor) }
    }
    catch (cause) {
      if (generation !== session.generation)
        return null
      throw receiptProblemFromUnknown(cause)
    }
  }
  async function revalidate(session: ReceiptFormSession) {
    if (session.busy)
      return null
    const generation = ++session.generation
    session.canWrite = false
    try {
      const value = await readCurrent(session.targetId)
      if (generation !== session.generation)
        return null
      session.context = value.context
      session.canWrite = value.canWrite
      return value
    }
    catch (cause) {
      if (generation !== session.generation)
        return null
      throw receiptProblemFromUnknown(cause)
    }
  }
  async function recover(session: ReceiptFormSession) {
    const pending = session.pending
    if (!pending || session.busy)
      throw receiptProblem('conflict', '请先等待原提交结果')
    const generation = session.generation
    session.busy = true
    try {
      recovery.verify(session.pendingKey, pending.id)
      checkContext(await repository().context(), pending.descriptor)
      let saved = pending
      if (!saved.result) {
        const resolved = await repository().resolve(saved.id)
        if (generation !== session.generation)
          throw receiptProblem('conflict', '页面目标已变化，请回原页面核对')
        if (resolved.outcome === 'not-applied') {
          if (resolved.commandId !== saved.id)
            throw receiptProblem('internal-error', '原编号封存结果不一致')
          recovery.clear(session.pendingKey, saved.id)
          session.pending = null
          if (!session.context) {
            session.busy = false
            const value = await hydrate(session, saved.descriptor.targetId)
            if (!value)
              throw receiptProblem('conflict', '页面目标已变化，请重新读取')
            return { outcome: 'not-applied' as const, ...value }
          }
          return { outcome: 'not-applied' as const, detail: null, context: session.context }
        }
        saved = { ...saved, result: resolved.result }
        session.pending = saved
      }
      const value = await readApplied(session, saved, generation)
      return { outcome: 'applied' as const, result: saved.result!, ...value }
    }
    finally {
      if (generation === session.generation)
        session.busy = false
    }
  }
  async function saveForm(session: ReceiptFormSession, draft: ReceiptDraft, action: ReceiptAction, attachments: FileRefChanges = {}) {
    if (!session.context)
      throw receiptProblem('unavailable', '请先成功读取收款表单后保存', {}, true)
    if (!session.canWrite)
      throw receiptProblem('forbidden', '当前收款或关联记录无写入权限')
    if (session.busy)
      throw receiptProblem('conflict', '收款正在保存，请等待当前结果')
    if (session.pending)
      throw receiptProblem('conflict', session.pending.result ? '收款已保存待刷新，请只核对原提交' : '原提交结果未知，请先核对原编号，再提交新的内容')
    const generation = session.generation
    const content = {
      ...(session.targetId ? { id: session.targetId } : {}),
      workspaceId: session.context.workspaceId,
      actorId: session.context.actorId,
      requiredCapability: RECEIPT_WRITE_CAPABILITY,
      baseVersion: session.baseVersion,
      origin: 'real' as const,
      action,
      draft,
      attachments,
    }
    const fingerprint = JSON.stringify(content)
    const commandId = crypto.randomUUID()
    const request: ReceiptCommand = { ...JSON.parse(fingerprint), commandId }
    const descriptor = { commandId, workspaceId: request.workspaceId, actorId: request.actorId, family: 'receipt', targetId: session.targetId, action }
    session.pendingKey = commandRecoveryKey(descriptor)
    try {
      recovery.remember(session.pendingKey, descriptor)
    }
    catch (cause) { throw receiptProblem('unavailable', cause instanceof Error ? cause.message : '无法可靠保留原编号', {}, true) }
    const pending: PendingReceipt = { id: commandId, fingerprint, descriptor, result: null }
    session.pending = pending
    session.busy = true
    try {
      checkContext(await repository().context(), descriptor)
      const result = await repository().execute(request)
      checkResult(result, pending)
      const saved = { ...pending, result }
      if (generation === session.generation)
        session.pending = saved
      if (generation === session.generation)
        latestWrite.value = { id: result.id, version: result.version }
      const read = await readApplied(session, saved, generation)
      return { ...result, detail: read.detail!, readbackConfirmed: true as const, retainedInput: JSON.stringify(content) !== fingerprint }
    }
    catch (cause) {
      if (generation !== session.generation)
        throw receiptProblem('conflict', '原收款结果仍需核对，请回原页面恢复原编号')
      if (session.pending?.result)
        throw receiptProblem('unavailable', '收款已保存待刷新；请保留输入并只重试原目标读取', {}, true)
      const problem = receiptProblemFromUnknown(cause)
      if (['conflict', 'validation-failed', 'relationship-mismatch', 'not-found', 'stale-source'].includes(problem.problem.code)) {
        try {
          const resolved = await repository().resolve(commandId)
          if (resolved.outcome === 'not-applied' && resolved.commandId === commandId && generation === session.generation) {
            recovery.clear(session.pendingKey, commandId)
            session.pending = null
          }
          else if (resolved.outcome === 'applied' && generation === session.generation) {
            checkResult(resolved.result, pending)
            session.pending = { ...pending, result: resolved.result }
          }
        }
        catch { /* Resolution failure retains the key and blocks new submissions. */ }
      }
      if (session.pending?.result)
        throw receiptProblem('unavailable', '收款已保存待刷新；请保留输入并只重试原目标读取', {}, true)
      if (problem.problem.code === 'conflict' && content.id && !Object.keys(problem.problem.fieldErrors).length) {
        let latest: ReceiptDetail | null = null
        try {
          latest = await repository().detail(content.id, { origin: 'real' })
        }
        catch { /* A failed comparison read must not advance the original base. */ }
        throw new ReceiptCommandConflict(problem.problem, latest)
      }
      throw problem
    }
    finally {
      if (generation === session.generation)
        session.busy = false
    }
  }
  function adoptConflictVersion(session: ReceiptFormSession, latest: ReceiptDetail) {
    if (session.pending)
      throw receiptProblem('conflict', '请先核对原提交，再采用新的收款版本')
    if (latest.record.id !== session.targetId || latest.record.dataOrigin !== 'real')
      throw receiptProblem('relationship-mismatch', '服务器版本不属于当前收款')
    if (!latest.capabilities.includes(RECEIPT_WRITE_CAPABILITY))
      throw receiptProblem('forbidden', '当前收款已无写入权限')
    session.baseVersion = latest.record.version
  }
  return { latestWrite: readonly(latestWrite), createSession, hydrate, revalidate, saveForm, recover, adoptConflictVersion }
}
