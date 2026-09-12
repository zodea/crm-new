import type { DataOriginDTO } from '../../types/read-model'
import type { SupplierCredentialAction, SupplierCredentialCommand, SupplierCredentialRepository, SupplierCredentialSnapshot } from './credential-contract'
import { computed, shallowReadonly, shallowRef } from 'vue'
import { credentialProblem, SUPPLIER_CREDENTIAL_WRITE_CAPABILITY } from './credential-contract'
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
export function createSupplierCredentialState(repository: SupplierCredentialRepository, targetFor: () => SupplierCredentialTarget, createId: () => string = () => crypto.randomUUID()) {
  const snapshot = shallowRef<SupplierCredentialSnapshot | null>(null)
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const errorCode = shallowRef('')
  const conflict = shallowRef(false)
  const ready = shallowRef(false)
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
      const result = await repository.read(target.supplierId, target.origin, { signal: request.signal })
      if (sequence !== generation || !matches(target) || request.signal.aborted)
        throw new DOMException('证照读取目标已变化', 'AbortError')
      if (result.supplierId !== target.supplierId || result.dataOrigin !== target.origin)
        throw credentialProblem('relationship-mismatch', '证照归属与当前分供方不匹配')
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
  async function execute(action: SupplierCredentialAction, base = baseline()) {
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
    const key = JSON.stringify([base.supplierId, base.origin, base.workspaceId, base.actorId, action])
    const command = pending.get(key) ?? { ...structuredClone(action), commandId: createId(), supplierId: base.supplierId, origin: base.origin, workspaceId: base.workspaceId, actorId: base.actorId, requiredCapability: SUPPLIER_CREDENTIAL_WRITE_CAPABILITY, baseSupplierVersion: base.supplierVersion, baseCredentialVersion: base.credentialVersion }
    pending.set(key, command)
    saving.value = true
    error.value = ''
    errorCode.value = ''
    const assertCurrent = () => {
      if (sequence !== generation || !matches(target))
        throw new DOMException('证照操作目标已变化，请返回原分供方查看结果', 'AbortError')
    }
    try {
      const result = await repository.execute(command)
      assertCurrent()
      const latest = await repository.read(target.supplierId, target.origin)
      assertCurrent()
      if (latest.supplierId !== target.supplierId || latest.dataOrigin !== target.origin)
        throw credentialProblem('relationship-mismatch', '证照回读归属不匹配')
      snapshot.value = latest
      pending.delete(key)
      conflict.value = false
      return result
    }
    catch (cause) {
      if (cause instanceof SupplierRepositoryProblem && !['unavailable', 'internal-error'].includes(cause.problem.code))
        pending.delete(key)
      if (cause instanceof SupplierRepositoryProblem && cause.problem.code === 'conflict') {
        pending.delete(key)
        blocked.add(baselineKey(base))
        if (sequence === generation && matches(target))
          conflict.value = true
      }
      if (sequence === generation && matches(target))
        recordError(cause)
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
    const result = await repository.file({ supplierId: target.supplierId, credentialId, fileId: record.file.id, origin: target.origin })
    if (sequence !== generation || !matches(target))
      throw new DOMException('原件读取目标已变化', 'AbortError')
    return result
  }
  return { data, loading: shallowReadonly(loading), saving: shallowReadonly(saving), error: shallowReadonly(error), errorCode: shallowReadonly(errorCode), conflict: shallowReadonly(conflict), canWrite, baseline, load, execute, recheck, file, cancelRead }
}
