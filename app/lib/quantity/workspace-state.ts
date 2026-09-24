import type { ProblemDTO } from '../../types/read-model'
import type { QuantityCommand, QuantityCommandResult, QuantityContext, QuantityReadQuery, QuantityReadResult } from './central-contract'

import { computed, readonly, shallowRef } from 'vue'
import { QUANTITY_WRITE_CAPABILITY, quantityProblem } from './central-contract'
import { quantityProblemFromUnknown } from './central-repository'

type WorkspaceCommand<A extends QuantityCommand['action']> = Omit<QuantityCommand, 'action'> & { action: A }
export interface QuantityWorkspaceDependencies<T extends { projectId: string }, Q extends QuantityReadQuery, A extends QuantityCommand['action']> {
  read: (query: Q) => Promise<QuantityReadResult<T>>
  context: () => Promise<QuantityContext>
  execute: (command: WorkspaceCommand<A>) => Promise<QuantityCommandResult>
}

/** Pinia 持有已读来源和命令身份，整页组件保留尚未提交的字段草稿。 */
export function createQuantityWorkspaceState<T extends { projectId: string }, Q extends QuantityReadQuery, A extends QuantityCommand['action']>(dependencies: QuantityWorkspaceDependencies<T, Q, A>) {
  const workspace = shallowRef<T | null>(null)
  const scope = shallowRef<Q | null>(null)
  const baseVersion = shallowRef<string | null>(null)
  const context = shallowRef<QuantityContext | null>(null)
  const capabilities = shallowRef<readonly string[]>([])
  const loading = shallowRef(false)
  const saving = shallowRef(false)
  const problem = shallowRef<ProblemDTO | null>(null)
  let generation = 0
  let identityGeneration = 0
  let pending: { id: string, fingerprint: string } | null = null
  const canWrite = computed(() => Boolean(workspace.value && baseVersion.value && scope.value?.origin === 'real'
    && context.value?.capabilities.includes(QUANTITY_WRITE_CAPABILITY) && capabilities.value.includes(QUANTITY_WRITE_CAPABILITY)))

  function cancel() {
    generation++
    identityGeneration++
    context.value = null
    loading.value = false
    saving.value = false
  }

  async function load(query: Q) {
    const current = ++generation
    const identityRequest = ++identityGeneration
    const request = { ...query }
    scope.value = request
    workspace.value = null
    baseVersion.value = null
    context.value = null
    capabilities.value = []
    pending = null
    problem.value = null
    loading.value = true
    saving.value = false
    try {
      const [response, identity] = await Promise.all([dependencies.read(request), dependencies.context()])
      if (current !== generation)
        return null
      if (response.data.projectId !== request.projectId || response.dataOrigin !== request.origin)
        throw quantityProblem('relationship-mismatch', '工程量工作面返回的项目或来源与当前选择不一致')
      workspace.value = response.data
      baseVersion.value = response.sourceVersion
      if (identityRequest === identityGeneration)
        context.value = identity
      capabilities.value = response.capabilities
      return response.data
    }
    catch (cause) {
      if (current !== generation)
        return null
      const error = quantityProblemFromUnknown(cause)
      problem.value = error.problem
      throw error
    }
    finally {
      if (current === generation)
        loading.value = false
    }
  }

  async function revalidate(): Promise<boolean> {
    const current = generation
    const identityRequest = ++identityGeneration
    context.value = null
    try {
      const identity = await dependencies.context()
      if (current === generation && identityRequest === identityGeneration) {
        context.value = identity
        problem.value = null
        return true
      }
      return false
    }
    catch (cause) {
      if (current !== generation || identityRequest !== identityGeneration)
        return false
      const error = quantityProblemFromUnknown(cause)
      problem.value = error.problem
      throw error
    }
  }

  async function execute(action: A) {
    if (!canWrite.value || !scope.value || !context.value || !baseVersion.value)
      throw quantityProblem('forbidden', '请成功读取有写入权限的正式项目后再保存工程量')
    if (saving.value)
      throw quantityProblem('conflict', '工程量工作面正在保存，请等待当前结果')
    const current = generation
    const body = {
      workspaceId: context.value.workspaceId,
      actorId: context.value.actorId,
      requiredCapability: QUANTITY_WRITE_CAPABILITY,
      baseVersion: baseVersion.value,
      origin: scope.value.origin,
      projectId: scope.value.projectId,
      action: structuredClone(action),
    }
    const fingerprint = JSON.stringify(body)
    if (pending?.fingerprint !== fingerprint)
      pending = { id: crypto.randomUUID(), fingerprint }
    const commandId = pending.id
    saving.value = true
    problem.value = null
    try {
      const result = await dependencies.execute({ ...body, commandId })
      if (current !== generation)
        return null
      baseVersion.value = result.sourceVersion
      pending = null
      return result
    }
    catch (cause) {
      if (current !== generation)
        return null
      const error = quantityProblemFromUnknown(cause)
      problem.value = error.problem
      if (error.problem.code === 'forbidden')
        context.value = null
      throw error
    }
    finally {
      if (current === generation)
        saving.value = false
    }
  }

  return { workspace: readonly(workspace), scope: readonly(scope), baseVersion: readonly(baseVersion), loading: readonly(loading), saving: readonly(saving), problem: readonly(problem), canWrite, load, revalidate, execute, cancel }
}
