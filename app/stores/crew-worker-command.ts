import type { CrewFormReadDTO, CrewWorkerCommandContextDTO, CrewWorkerCommandResultDTO, WorkerCommandRequestDTO, WorkerFormReadDTO } from '~/lib/crew-worker/command-contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import type { CrewFormDraft, FormAttachmentChanges, MasterDataSaveAction, WorkerFormDraft } from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import { readonly, shallowReactive, shallowRef } from 'vue'
import { CREW_WRITE_CAPABILITY, WORKER_WRITE_CAPABILITY } from '~/lib/crew-worker/command-contract'
import { crewWorkerProblem, crewWorkerProblemFromUnknown, CrewWorkerRepositoryProblem } from '~/lib/crew-worker/repository'
import { commandRecoveryKey, commandVersionAtLeast, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { createFormCommandActions } from '~/lib/forms/command-session'

export class CrewWorkerCommandConflictError extends Error {
  constructor(public readonly kind: 'crew' | 'worker', public readonly latest: CrewFormReadDTO | WorkerFormReadDTO) {
    super(`${kind === 'crew' ? '班组' : '工人'}已有更新版本，请选择如何处理`)
    this.name = 'CrewWorkerCommandConflictError'
  }
}

export class CrewWorkerMembershipConflictError extends Error {
  constructor(
    public readonly workerId: string,
    public readonly expectedCrewId: string | null,
    public readonly latestCrewId: string | null,
  ) {
    super('工人档案或班组归属已变化，已刷新最新成员关系，请重新选择')
    this.name = 'CrewWorkerMembershipConflictError'
  }
}

export interface CrewMembershipRecovery {
  key: string
  descriptor: CommandRecoveryDescriptor
  resultKnown: boolean
}

function emptyChanges(changes: FormAttachmentChanges): FormAttachmentChanges {
  return {
    ...(changes.add?.length ? { add: changes.add } : {}),
    ...(changes.removeIds?.length ? { removeIds: changes.removeIds } : {}),
    ...(changes.restoreIds?.length ? { restoreIds: changes.restoreIds } : {}),
  }
}

export const useCrewWorkerCommandStore = defineStore('crew-worker-command', () => {
  function createMembershipSession() {
    return { busy: false, pendingKey: '', receipts: new Map<string, CrewWorkerCommandResultDTO>(), pending: null as { fingerprint: string, request: WorkerCommandRequestDTO, result: CrewWorkerCommandResultDTO | null } | null }
  }
  type MembershipSession = ReturnType<typeof createMembershipSession>
  const membershipRecovery = createCommandRecoveryStorage()
  const latestWrite = shallowRef<{ kind: 'crew' | 'worker', id: string, version: string } | null>(null)

  const repository = () => useNuxtApp().$repositories.crewWorkerCommands
  const recoveryGuard = (message: string) => new CrewWorkerRepositoryProblem(crewWorkerProblem('unavailable', message, true))
  async function authorizeMembership(original: Pick<CommandRecoveryDescriptor, 'workspaceId' | 'actorId'> | null, isCurrent: () => boolean) {
    const context = await repository().context()
    if (!isCurrent() || !context.capabilities.includes(WORKER_WRITE_CAPABILITY) || (original && (context.workspaceId !== original.workspaceId || context.actorId !== original.actorId)))
      throw recoveryGuard('原成员操作身份或权限已变化，请保留原编号。')
    return context
  }

  async function inspectMembershipRecovery(session: MembershipSession, crewId: string, isCurrent: () => boolean = () => true): Promise<CrewMembershipRecovery[]> {
    const context = await authorizeMembership(null, isCurrent)
    const prefix = `crm:form-command:v1:${['worker-membership', context.workspaceId, context.actorId].map(encodeURIComponent).join(':')}:`
    const recoveries: CrewMembershipRecovery[] = []
    try {
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index)
        if (!key?.startsWith(prefix))
          continue
        const descriptor = membershipRecovery.read(key)
        if (!descriptor || descriptor.action !== 'membership' || descriptor.targetId === null)
          throw new Error('成员原恢复定位无效，请保留原编号。')
        // Old descriptors have no crew context. Keep them explicit; never assign them to this crew.
        if (descriptor.scopeId !== undefined && descriptor.scopeId !== crewId)
          continue
        recoveries.push({ key, descriptor, resultKnown: (session.pending?.request.commandId === descriptor.commandId && session.pending.result !== null) || session.receipts.has(descriptor.commandId) })
      }
    }
    catch { throw recoveryGuard('无法可靠核对原提交编号，请保留输入并恢复浏览器存储。') }
    await authorizeMembership(context, isCurrent)
    return recoveries
  }

  async function recoverMembership(session: MembershipSession, crewId: string, descriptor: CommandRecoveryDescriptor, isCurrent: () => boolean = () => true) {
    if (session.busy || !isCurrent())
      throw recoveryGuard('此成员恢复已失效或仍在处理中。')
    session.busy = true
    try {
      const key = commandRecoveryKey(descriptor)
      const saved = membershipRecovery.read(key)
      if (!saved || saved.family !== 'worker-membership' || saved.action !== 'membership' || saved.targetId === null || descriptor.action !== saved.action
        || saved.commandId !== descriptor.commandId || saved.scopeId !== descriptor.scopeId || (saved.scopeId !== undefined && saved.scopeId !== crewId)) {
        throw recoveryGuard('成员原恢复定位或班组上下文不一致，请保留原编号。')
      }
      await authorizeMembership(saved, isCurrent)
      let result = session.pending?.request.commandId === saved.commandId ? session.pending.result : session.receipts.get(saved.commandId) ?? null
      if (!result) {
        const resolution = await repository().resolveWorker(saved.commandId)
        await authorizeMembership(saved, isCurrent)
        if (resolution.outcome === 'not-applied') {
          if (resolution.commandId !== saved.commandId)
            throw recoveryGuard('成员原编号封存结果不一致。')
          membershipRecovery.clear(key, saved.commandId)
          if (session.pending?.request.commandId === saved.commandId)
            session.pending = null
          session.receipts.delete(saved.commandId)
          return resolution
        }
        result = resolution.result
      }
      if (result.commandId !== saved.commandId || result.id !== saved.targetId || !commandVersionAtLeast(result.version, result.version) || !Number.isFinite(Date.parse(result.updatedAt)))
        throw recoveryGuard('成员原回执与工人或编号不一致，请保留原编号。')
      session.receipts.set(saved.commandId, result)
      if (session.pending?.request.commandId === saved.commandId)
        session.pending.result = result
      const form = await repository().loadWorkerForm(result.id)
      await authorizeMembership(saved, isCurrent)
      if (form.draft.id !== saved.targetId || !commandVersionAtLeast(form.version, result.version))
        throw recoveryGuard('成员已保存待刷新，请只核对原工人读取。')
      membershipRecovery.clear(key, saved.commandId)
      if (session.pending?.request.commandId === saved.commandId)
        session.pending = null
      session.receipts.delete(saved.commandId)
      latestWrite.value = { kind: 'worker', id: result.id, version: result.version }
      return { outcome: 'applied' as const, result }
    }
    catch (cause) { throw crewWorkerProblemFromUnknown(cause) }
    finally { session.busy = false }
  }
  const crewActions = createFormCommandActions<CrewWorkerCommandContextDTO, typeof CREW_WRITE_CAPABILITY, CrewFormDraft, MasterDataSaveAction, FormAttachmentChanges, CrewFormReadDTO>({
    capability: CREW_WRITE_CAPABILITY,
    problemFromUnknown: crewWorkerProblemFromUnknown,
    conflict: latest => new CrewWorkerCommandConflictError('crew', latest),
    repository: () => ({ context: repository().context, loadForm: repository().loadCrewForm, execute: repository().executeCrew, resolve: repository().resolveCrew }),
  })
  const workerActions = createFormCommandActions<CrewWorkerCommandContextDTO, typeof WORKER_WRITE_CAPABILITY, WorkerFormDraft, MasterDataSaveAction, FormAttachmentChanges, WorkerFormReadDTO>({
    capability: WORKER_WRITE_CAPABILITY,
    problemFromUnknown: crewWorkerProblemFromUnknown,
    conflict: latest => new CrewWorkerCommandConflictError('worker', latest),
    repository: () => ({ context: repository().context, loadForm: repository().loadWorkerForm, execute: repository().executeWorker, resolve: repository().resolveWorker }),
  })
  function createSession() {
    const persistent = { crew: crewActions.createSession(), worker: workerActions.createSession() }
    return shallowReactive({
      persistent,
      get targets() { return { crew: persistent.crew.targetId, worker: persistent.worker.targetId } },
      get versions() { return { crew: persistent.crew.baseVersion, worker: persistent.worker.baseVersion } },
    })
  }
  type CommandSession = ReturnType<typeof createSession>
  const actions = (kind: 'crew' | 'worker') => kind === 'crew' ? crewActions : workerActions
  const formSession = (session: CommandSession, kind: 'crew' | 'worker') => session.persistent[kind]

  async function hydrate(session: CommandSession, kind: 'crew' | 'worker', id: string | null) {
    const read = await actions(kind).hydrate(formSession(session, kind), id)
    return {
      draft: read.form?.draft ?? null,
      attachments: [],
      pendingAttachments: [],
      pendingRemoveIds: [],
      pendingRestoreIds: [],
      restoredLocalDraft: null,
      productionNotice: read.recoveryOutcome === 'applied'
        ? '已核对上次提交：保存成功，现已读取同一档案。'
        : read.recovered ? '已核对上次提交：没有保存，迟到请求已封存。刷新前未保存的输入需重新填写。' : '',
    }
  }
  function revalidate(session: CommandSession, kind: 'crew' | 'worker') {
    return actions(kind).revalidate(formSession(session, kind))
  }
  function deactivate(session: CommandSession, kind: 'crew' | 'worker') {
    actions(kind).invalidate(formSession(session, kind))
  }
  function startNew(session: CommandSession, kind: 'crew' | 'worker') {
    actions(kind).startNew(formSession(session, kind))
  }
  function rebase(session: CommandSession, kind: 'crew' | 'worker', version: string) {
    const original = formSession(session, kind)
    if (original.pending || original.busy)
      throw new Error('请先核对原提交，再采用新的档案版本。')
    original.baseVersion = version
  }
  function acceptLatest(session: CommandSession, kind: 'crew' | 'worker', latest: CrewFormReadDTO | WorkerFormReadDTO) {
    if (kind === 'crew')
      crewActions.adoptConflictVersion(formSession(session, kind), latest as CrewFormReadDTO)
    else
      workerActions.adoptConflictVersion(formSession(session, kind), latest as WorkerFormReadDTO)
  }
  async function recover(session: CommandSession, kind: 'crew' | 'worker') {
    const resolved = await actions(kind).recover(formSession(session, kind))
    if (resolved.outcome === 'applied')
      latestWrite.value = { kind, id: resolved.result.id, version: resolved.result.version }
    return resolved
  }
  async function saveCrew(session: CommandSession, draft: CrewFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    const result = await crewActions.saveForm(session.persistent.crew, draft, action, emptyChanges(attachments))
    latestWrite.value = { kind: 'crew', id: result.id, version: result.version }
    return { ...result, logId: null }
  }
  async function saveWorker(session: CommandSession, draft: WorkerFormDraft, action: MasterDataSaveAction, attachments: FormAttachmentChanges = {}) {
    const result = await workerActions.saveForm(session.persistent.worker, draft, action, emptyChanges(attachments))
    latestWrite.value = { kind: 'worker', id: result.id, version: result.version }
    return { ...result, logId: null }
  }

  async function setWorkerCrewMembership(session: MembershipSession, input: {
    workerId: string
    expectedCrewId: string | null
    crewId: string | null
  }, isCurrent: () => boolean = () => true) {
    if (!isCurrent() || session.busy)
      throw new Error('此成员操作已失效或仍在处理中。')
    const fingerprint = JSON.stringify(input)
    let pending = session.pending
    if (pending && pending.fingerprint !== fingerprint)
      throw new Error('原成员提交结果未知，不能以新归属或另一工人替换原命令。')
    session.busy = true
    const authorize = async (original: { workspaceId: string, actorId: string }) => {
      const current = await repository().context()
      if (!isCurrent() || current.workspaceId !== original.workspaceId || current.actorId !== original.actorId || !current.capabilities.includes(WORKER_WRITE_CAPABILITY))
        throw new Error('原成员操作身份或权限已变化，请保留原编号。')
      return current
    }
    const readApplied = async (result: CrewWorkerCommandResultDTO, original: { workspaceId: string, actorId: string }, commandId: string) => {
      if (result.commandId !== commandId || result.id !== input.workerId || !commandVersionAtLeast(result.version, result.version) || !Number.isFinite(Date.parse(result.updatedAt)))
        throw new Error('成员原回执与工人或编号不一致，请保留原编号。')
      const form = await repository().loadWorkerForm(result.id)
      await authorize(original)
      if (form.draft.id !== result.id || !commandVersionAtLeast(form.version, result.version))
        throw new Error('成员已保存待刷新，请只核对原工人读取。')
      return form
    }
    try {
      if (!pending) {
        const [context, form] = await Promise.all([repository().context(), repository().loadWorkerForm(input.workerId)])
        if (!isCurrent() || !context.capabilities.includes(WORKER_WRITE_CAPABILITY) || form.draft.id !== input.workerId)
          throw new Error('当前身份或工人目标不能执行此成员操作，或此操作已失效。')
        const key = commandRecoveryKey({ ...context, family: 'worker-membership', targetId: input.workerId })
        session.pendingKey = key
        const descriptor = membershipRecovery.read(key)
        if (descriptor) {
          throw new Error('请先通过原成员提交恢复入口核对原编号，再选择新的成员操作。')
        }
        const latestCrewId = form.draft.crewId || null
        if (latestCrewId !== input.expectedCrewId)
          throw new CrewWorkerMembershipConflictError(input.workerId, input.expectedCrewId, latestCrewId)
        const request: WorkerCommandRequestDTO = {
          id: input.workerId,
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          requiredCapability: WORKER_WRITE_CAPABILITY,
          commandId: crypto.randomUUID(),
          baseVersion: form.version,
          action: form.draft.status === 'draft' ? 'draft' : 'save',
          draft: { ...form.draft, crewId: input.crewId },
          attachments: {},
        }
        membershipRecovery.remember(key, { workspaceId: context.workspaceId, actorId: context.actorId, commandId: request.commandId, family: 'worker-membership', targetId: input.workerId, scopeId: input.crewId ?? input.expectedCrewId ?? undefined, action: 'membership' })
        pending = { fingerprint, request, result: null }
        session.pending = pending
      }
      membershipRecovery.verify(session.pendingKey, pending.request.commandId)
      await authorize(pending.request)
      if (!pending.result) {
        const result = await repository().executeWorker(pending.request)
        pending.result = result
      }
      await readApplied(pending.result, pending.request, pending.request.commandId)
      membershipRecovery.clear(session.pendingKey, pending.request.commandId)
      if (session.pending === pending)
        session.pending = null
      latestWrite.value = { kind: 'worker', id: pending.result.id, version: pending.result.version }
      return pending.result
    }
    catch (cause) {
      if (cause instanceof CrewWorkerMembershipConflictError)
        throw cause
      if (!pending)
        throw cause
      const problem = crewWorkerProblemFromUnknown(cause)
      if (pending && !pending.result && ['conflict', 'validation-failed', 'relationship-mismatch', 'not-found'].includes(problem.problem.code)) {
        const resolution = await repository().resolveWorker(pending.request.commandId).catch(() => null)
        if (resolution?.outcome === 'applied') {
          pending.result = resolution.result
        }
        else if (resolution?.outcome === 'not-applied' && resolution.commandId === pending.request.commandId) {
          await authorize(pending.request)
          membershipRecovery.clear(session.pendingKey, pending.request.commandId)
          if (session.pending === pending)
            session.pending = null
          if (problem.problem.code === 'conflict') {
            const latest = await repository().loadWorkerForm(input.workerId)
            await authorize(pending.request)
            if (latest.draft.id !== input.workerId)
              throw new Error('冲突读取与原工人不一致。')
            throw new CrewWorkerMembershipConflictError(input.workerId, input.expectedCrewId, latest.draft.crewId || null)
          }
        }
      }
      throw problem
    }
    finally { session.busy = false }
  }

  return { latestWrite: readonly(latestWrite), createSession, formSession, createMembershipSession, inspectMembershipRecovery, recoverMembership, setWorkerCrewMembership, hydrate, revalidate, deactivate, recover, saveCrew, saveWorker, startNew, rebase, acceptLatest }
})
