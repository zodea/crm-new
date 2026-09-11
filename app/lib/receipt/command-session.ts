import type { FileRefChanges } from '../forms/file-refs'
import type { ReceiptAction, ReceiptCommand, ReceiptContext, ReceiptDetail, ReceiptDraft } from './contract'
import type { ReceiptRepository } from './repository'
import { readonly, shallowRef } from 'vue'
import { RECEIPT_WRITE_CAPABILITY, receiptProblem, ReceiptRepositoryProblem } from './contract'
import { receiptProblemFromUnknown } from './repository'

export interface ReceiptFormSession {
  targetId: string | null
  baseVersion: string | null
  context: ReceiptContext | null
  generation: number
  canWrite: boolean
  busy: boolean
  pending: { id: string, fingerprint: string } | null
}

export class ReceiptCommandConflict extends ReceiptRepositoryProblem {
  constructor(problem: ReceiptRepositoryProblem['problem'], readonly latest: ReceiptDetail | null) {
    super(problem)
    this.name = 'ReceiptCommandConflict'
  }
}

/** 组件持有短生命周期草稿；Pinia action 管理命令身份和已确认版本。 */
export function createReceiptCommandActions(repository: () => Pick<ReceiptRepository, 'context' | 'detail' | 'execute'>) {
  const latestWrite = shallowRef<{ id: string, version: string } | null>(null)

  function createSession(): ReceiptFormSession {
    return { targetId: null, baseVersion: null, context: null, generation: 0, canWrite: false, busy: false, pending: null }
  }

  async function readCurrent(id: string | null) {
    const [context, detail] = await Promise.all([repository().context(), id ? repository().detail(id, { origin: 'real' }) : Promise.resolve(null)])
    const canWrite = context.capabilities.includes(RECEIPT_WRITE_CAPABILITY) && (!detail || detail.capabilities.includes(RECEIPT_WRITE_CAPABILITY))
    return { context, detail, canWrite }
  }

  async function hydrate(session: ReceiptFormSession, id: string | null) {
    const generation = ++session.generation
    Object.assign(session, { targetId: id, baseVersion: null, context: null, pending: null, canWrite: false, busy: false })
    try {
      const { context, detail, canWrite } = await readCurrent(id)
      if (generation !== session.generation)
        return null
      session.context = context
      session.baseVersion = detail?.record.version ?? null
      session.canWrite = canWrite
      return { context, detail }
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
      // 仅恢复当前权限和候选，保留原版本、命令身份与用户草稿。
      return value
    }
    catch (cause) {
      if (generation !== session.generation)
        return null
      throw receiptProblemFromUnknown(cause)
    }
  }

  async function saveForm(session: ReceiptFormSession, draft: ReceiptDraft, action: ReceiptAction, attachments: FileRefChanges = {}) {
    if (!session.context)
      throw receiptProblem('unavailable', '请先成功读取收款表单后保存', {}, true)
    if (!session.canWrite)
      throw receiptProblem('forbidden', '当前收款或关联记录无写入权限')
    if (session.busy)
      throw receiptProblem('conflict', '收款正在保存，请等待当前结果')
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
    if (!session.pending || session.pending.fingerprint !== fingerprint)
      session.pending = { id: crypto.randomUUID(), fingerprint }
    const commandId = session.pending.id
    const request: ReceiptCommand = { ...JSON.parse(fingerprint), commandId }
    session.busy = true
    try {
      const result = await repository().execute(request)
      if (generation === session.generation && session.pending?.id === commandId) {
        session.targetId = result.id
        session.baseVersion = result.version
        session.pending = null
      }
      latestWrite.value = { id: result.id, version: result.version }
      return result
    }
    catch (cause) {
      const problem = receiptProblemFromUnknown(cause)
      if (problem.problem.code === 'conflict' && content.id && !Object.keys(problem.problem.fieldErrors).length) {
        let latest: ReceiptDetail | null = null
        try {
          latest = await repository().detail(content.id, {
            origin: 'real',
          })
        }
        catch { /* 保留原冲突及本页草稿，重读失败不得前移版本。 */ }
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
    if (latest.record.id !== session.targetId || latest.record.dataOrigin !== 'real')
      throw receiptProblem('relationship-mismatch', '服务器版本不属于当前收款')
    if (!latest.capabilities.includes(RECEIPT_WRITE_CAPABILITY))
      throw receiptProblem('forbidden', '当前收款已无写入权限')
    session.baseVersion = latest.record.version
    session.pending = null
  }

  return { latestWrite: readonly(latestWrite), createSession, hydrate, revalidate, saveForm, adoptConflictVersion }
}
