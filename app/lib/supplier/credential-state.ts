import type { DataOriginDTO, ProblemDTO } from '../../types/read-model'
import type { SupplierCredentialAction, SupplierCredentialCommand, SupplierCredentialRepository, SupplierCredentialSnapshot } from './credential-contract'
import type { SupplierProductionRepository } from './production-repository'
import { computed, shallowReadonly, shallowRef } from 'vue'
import { credentialProblem, SUPPLIER_CREDENTIAL_WRITE_CAPABILITY, SupplierCredentialNotAppliedProblem } from './credential-contract'
import { clearSupplierPending, readSupplierPending, rememberSupplierPending, SUPPLIER_PERSISTENT_CAPABILITY, supplierPendingKey } from './pending'
import { SupplierRepositoryProblem } from './read-contract'

export interface SupplierCredentialTarget { supplierId: string, origin: DataOriginDTO, enabled: boolean }
export interface SupplierCredentialBaseline {
  supplierId: string
  origin: DataOriginDTO
  workspaceId: string
  actorId: string
  supplierVersion: string
  credentialVersion: string
  generation: number
}

/** 每个 KeepAlive 页面独占请求序列和待恢复命令，避免同名分供方或页签间串档。 */
export function createSupplierCredentialState(repository: SupplierCredentialRepository, targetFor: () => SupplierCredentialTarget, createId: () => string = () => crypto.randomUUID(), production?: SupplierProductionRepository) {
  const snapshot = shallowRef<SupplierCredentialSnapshot | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const errorCode = shallowRef('')
  const conflict = shallowRef(false)
  const ready = shallowRef(false)
  const recoveryNotice = shallowRef('')
  let generation = 0
  let controller: AbortController | null = null
  let lastTarget = ''
  const pending = new Map<string, SupplierCredentialCommand>()
  const blocked = new Set<string>()
  function matches(target: SupplierCredentialTarget) {
    const current = targetFor()
    return current.enabled && current.supplierId === target.supplierId && current.origin === target.origin
  }
  const data = computed(() => {
    const target = targetFor()
    return target.enabled && snapshot.value?.supplierId === target.supplierId && snapshot.value.dataOrigin === target.origin ? snapshot.value : null
  })
  const canWrite = computed(() => ready.value && !loading.value && targetFor().origin === 'real' && data.value?.capabilities.includes(SUPPLIER_CREDENTIAL_WRITE_CAPABILITY) === true)
  function baseline(): SupplierCredentialBaseline | null {
    const current = data.value
    return current && ready.value ? { supplierId: current.supplierId, origin: current.dataOrigin, workspaceId: current.workspaceId, actorId: current.actorId, supplierVersion: current.supplierVersion, credentialVersion: current.credentialVersion, generation } : null
  }
  function cancelRead() {
    generation++
    controller?.abort()
    controller = null
    ready.value = false
    loading.value = false
  }
  function invalidate(problem: ProblemDTO) {
    cancelRead()
    snapshot.value = null
    error.value = problem.message
    errorCode.value = problem.code
    recoveryNotice.value = ''
  }
  function recordError(cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '证照操作失败，请重试'
    errorCode.value = cause instanceof SupplierRepositoryProblem ? cause.problem.code : 'unavailable'
  }
  async function load() {
    cancelRead()
    const target = { ...targetFor() }
    const key = JSON.stringify([target.supplierId, target.origin])
    if (key !== lastTarget) {
      lastTarget = key
      conflict.value = false
    }
    const sequence = generation
    error.value = ''
    errorCode.value = ''
    if (!matches(target)) {
      snapshot.value = null
      error.value = '测试数据未开启，请先开启并通过查看权限核验'
      errorCode.value = 'forbidden'
      return null
    }
    if (snapshot.value?.supplierId !== target.supplierId || snapshot.value.dataOrigin !== target.origin)
      snapshot.value = null
    const request = new AbortController()
    controller = request
    loading.value = true
    try {
      let result = await repository.read(target.supplierId, target.origin, { signal: request.signal })
      if (sequence !== generation || !matches(target) || request.signal.aborted)
        throw new DOMException('证照读取目标已变化', 'AbortError')
      if (result.supplierId !== target.supplierId || result.dataOrigin !== target.origin)
        throw credentialProblem('relationship-mismatch', '证照归属与当前分供方不匹配')
      recoveryNotice.value = ''
      if (result.dataOrigin === 'real' && result.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY)) {
        const key = supplierPendingKey(result, `credential:${result.supplierId}`)
        const commandId = readSupplierPending(key)
        if (commandId) {
          if (!production)
            throw credentialProblem('unavailable', '原证照提交核对服务不可用，请保留编号。')
          const resolved = await production.resolve(commandId)
          if (resolved.result && (!('supplierId' in resolved.result) || 'verification' in resolved.result || resolved.result.supplierId !== result.supplierId))
            throw credentialProblem('relationship-mismatch', '原证照回执与当前分供方不一致。')
          const fresh = await repository.read(target.supplierId, target.origin, { signal: request.signal })
          if (sequence !== generation || !matches(target) || request.signal.aborted)
            throw new DOMException('证照恢复目标已变化', 'AbortError')
          if (fresh.supplierId !== result.supplierId || fresh.dataOrigin !== 'real' || fresh.workspaceId !== result.workspaceId || fresh.actorId !== result.actorId || !fresh.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY))
            throw credentialProblem('forbidden', '证照恢复期间身份或权限变化，请重新核对。')
          clearSupplierPending(key, commandId)
          for (const [pendingKey, command] of pending) {
            if (command.commandId === commandId)
              pending.delete(pendingKey)
          }
          result = fresh
          recoveryNotice.value = resolved.outcome === 'applied' ? '已核对原证照提交：保存成功，现已重新读取原件与资料。' : '原证照提交没有保存，迟到请求已封存。请核对资料后重新操作。'
        }
      }
      snapshot.value = result
      ready.value = true
      return result
    }
    catch (cause) {
      if (sequence === generation && matches(target) && !request.signal.aborted) {
        snapshot.value = null
        recordError(cause)
      }
      throw cause
    }
    finally {
      if (sequence === generation) {
        loading.value = false
        controller = null
      }
    }
  }
  function baselineKey(base: SupplierCredentialBaseline) {
    return JSON.stringify([base.supplierId, base.origin, base.workspaceId, base.actorId, base.supplierVersion, base.credentialVersion])
  }
  function pendingKey(action: SupplierCredentialAction, base: SupplierCredentialBaseline) {
    return JSON.stringify([base.supplierId, base.origin, base.workspaceId, base.actorId, action])
  }
  function hasPending(action: SupplierCredentialAction, base = baseline()) {
    return base !== null && pending.has(pendingKey(action, base))
  }
  async function execute(action: SupplierCredentialAction, base = baseline()) {
    if (action.action === 'ocr-confirm' && !data.value?.capabilities.includes('supplier:write'))
      throw credentialProblem('forbidden', '无分供方主档写入权限，不能保存人工确认')
    if (!base || !canWrite.value || base.supplierId !== data.value?.supplierId || base.origin !== data.value.dataOrigin)
      throw credentialProblem('forbidden', '请先读取当前分供方证照及写入权限')
    if (base.workspaceId !== data.value.workspaceId || base.actorId !== data.value.actorId) {
      conflict.value = true
      throw credentialProblem('conflict', '当前工作区或操作身份已变化，请重新核对后再保存')
    }
    if (saving.value)
      throw credentialProblem('conflict', '证照操作仍在保存，请等待结果')
    if (blocked.has(baselineKey(base)))
      throw credentialProblem('conflict', '资料已发生变化，请先重新核对当前资料')
    const target = { ...targetFor() }
    const sequence = generation
    const key = pendingKey(action, base)
    const recovering = pending.has(key)
    const command = pending.get(key) ?? { ...structuredClone(action), commandId: createId(), supplierId: base.supplierId, origin: base.origin, workspaceId: base.workspaceId, actorId: base.actorId, requiredCapability: SUPPLIER_CREDENTIAL_WRITE_CAPABILITY, baseSupplierVersion: base.supplierVersion, baseCredentialVersion: base.credentialVersion }
    pending.set(key, command)
    saving.value = true
    error.value = ''
    errorCode.value = ''
    const assertCurrent = () => {
      if (sequence !== generation || !matches(target))
        throw new DOMException('证照操作目标已变化，请返回原分供方查看结果', 'AbortError')
    }
    let acknowledged = false
    const persistedKey = data.value.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY) ? supplierPendingKey(base, `credential:${base.supplierId}`) : ''
    try {
      const original = persistedKey ? readSupplierPending(persistedKey) : null
      let result
      if (original) {
        if (!production)
          throw credentialProblem('unavailable', '原证照提交核对服务不可用，请保留编号。')
        const resolved = await production.resolve(original)
        assertCurrent()
        if (!resolved.result) {
          clearSupplierPending(persistedKey, original)
          throw new SupplierCredentialNotAppliedProblem(command.commandId, '原提交没有保存且已封存，请重新核对当前资料后操作。', 'conflict')
        }
        if (!('supplierId' in resolved.result) || 'verification' in resolved.result || resolved.result.supplierId !== target.supplierId || original !== command.commandId)
          throw credentialProblem('conflict', '另一笔原证照提交待核对，请重新读取当前资料。')
        result = resolved.result
      }
      else {
        if (persistedKey)
          rememberSupplierPending(persistedKey, command.commandId)
        result = await repository.execute(command)
      }
      acknowledged = true
      assertCurrent()
      const latest = await repository.read(target.supplierId, target.origin)
      assertCurrent()
      if (latest.supplierId !== target.supplierId || latest.dataOrigin !== target.origin)
        throw credentialProblem('relationship-mismatch', '证照回读归属不匹配')
      if (persistedKey) {
        if (latest.workspaceId !== base.workspaceId || latest.actorId !== base.actorId || !latest.capabilities.includes(SUPPLIER_PERSISTENT_CAPABILITY))
          throw credentialProblem('forbidden', '证照回读时身份或权限变化，请保留原提交编号。')
        clearSupplierPending(persistedKey, command.commandId)
      }
      snapshot.value = latest
      pending.delete(key)
      conflict.value = false
      return result
    }
    catch (cause) {
      const notApplied = cause instanceof SupplierCredentialNotAppliedProblem && cause.commandId === command.commandId
      if (notApplied || (!recovering && !acknowledged && cause instanceof SupplierRepositoryProblem && !['unavailable', 'internal-error', 'unauthenticated', 'forbidden'].includes(cause.problem.code)))
        pending.delete(key)
      if ((!recovering || notApplied) && !acknowledged && cause instanceof SupplierRepositoryProblem && cause.problem.code === 'conflict') {
        pending.delete(key)
        blocked.add(baselineKey(base))
        if (sequence === generation && matches(target))
          conflict.value = true
      }
      if (sequence === generation && matches(target))
        recordError(cause)
      if (sequence === generation && cause instanceof SupplierRepositoryProblem && ['unauthenticated', 'forbidden'].includes(cause.problem.code))
        invalidate(cause.problem)
      throw cause
    }
    finally { saving.value = false }
  }
  async function recheck() {
    const current = await load()
    if (current) {
      conflict.value = false
      const base = baseline()
      if (base)
        blocked.delete(baselineKey(base))
      return base
    }
    return null
  }
  async function file(credentialId: string) {
    const target = { ...targetFor() }
    const sequence = generation
    const record = data.value?.credentials.find(row => row.id === credentialId)
    if (!record?.file || !ready.value)
      throw credentialProblem('not-found', '此证照未保存可读取的原件')
    let result
    try {
      result = await repository.file({ supplierId: target.supplierId, credentialId, fileId: record.file.id, origin: target.origin })
    }
    catch (cause) {
      if (sequence === generation && cause instanceof SupplierRepositoryProblem && ['unauthenticated', 'forbidden'].includes(cause.problem.code))
        invalidate(cause.problem)
      throw cause
    }
    if (sequence !== generation || !matches(target))
      throw new DOMException('原件读取目标已变化', 'AbortError')
    return result
  }
  return { data, loading: shallowReadonly(loading), saving: shallowReadonly(saving), error: shallowReadonly(error), errorCode: shallowReadonly(errorCode), conflict: shallowReadonly(conflict), recoveryNotice: shallowReadonly(recoveryNotice), canWrite, baseline, load, execute, recheck, file, cancelRead, invalidate, hasPending }
}
