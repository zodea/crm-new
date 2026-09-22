import type { BoqBuildingCommand, BoqBuildingContext, BoqBuildingQuery } from '~/lib/boq/central-building-contract'
import { useSessionStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { generateId } from '~/lib/util/id'

export const useBoqBuildingStore = defineStore('boq-building-evidence', () => {
  const context = shallowRef<BoqBuildingContext | null>(null)
  const saving = shallowRef(false)
  const pending = useSessionStorage<Record<string, BoqBuildingCommand>>('ruihang:boq-building-pending-v1', {})
  const repository = () => useNuxtApp().$repositories.boqBuilding
  let sequence = 0
  let target = ''
  const keyFor = (value: Pick<BoqBuildingContext, 'workspaceId' | 'actorId' | 'origin' | 'projectId' | 'contractId'>) => JSON.stringify([value.workspaceId, value.actorId, value.origin, value.projectId, value.contractId])
  const pendingCommand = computed(() => context.value ? pending.value[keyFor(context.value)] ?? null : null)

  async function read(query: BoqBuildingQuery) {
    const request = ++sequence
    const requested = JSON.stringify(query)
    if (target !== requested) {
      context.value = null
      saving.value = false
    }
    target = requested
    const value = await repository().read(query)
    if (request === sequence && requested === target)
      context.value = value
    return value
  }
  function clearPending(key: string) {
    const next = { ...pending.value }
    delete next[key]
    pending.value = next
  }
  async function send(command: BoqBuildingCommand) {
    const key = keyFor(command)
    saving.value = true
    let acknowledged = false
    try {
      const result = await repository().execute(JSON.parse(JSON.stringify(command)))
      acknowledged = true
      if (context.value && key === keyFor(context.value))
        await read({ projectId: command.projectId, contractId: command.contractId, origin: command.origin })
      clearPending(key)
      return result
    }
    catch (cause) {
      const problem = projectProblemFromUnknown(cause).problem as ReturnType<typeof projectProblemFromUnknown>['problem'] & { commandId?: string, commandOutcome?: string }
      if (!acknowledged && problem.commandId === command.commandId && problem.commandOutcome === 'not-applied' && ['validation-failed', 'stale-source', 'relationship-mismatch', 'not-found'].includes(problem.code))
        clearPending(key)
      throw cause
    }
    finally {
      if (context.value && key === keyFor(context.value))
        saving.value = false
    }
  }
  function save(value: BoqBuildingContext, lineId: string, buildingId: string, reason: string) {
    if (!context.value || keyFor(value) !== keyFor(context.value) || value.origin !== 'real' || !value.capabilities.includes('owner-document:write'))
      throw new Error('当前身份或项目不允许更正合同楼栋证据')
    if (pendingCommand.value)
      throw new Error('请先核对原提交结果')
    const command: BoqBuildingCommand = { commandId: generateId('boq-building-command'), workspaceId: value.workspaceId, actorId: value.actorId, projectId: value.projectId, contractId: value.contractId, origin: value.origin, requiredCapability: 'owner-document:write', sourceVersion: value.sourceVersion, lineId, buildingId, reason }
    pending.value = { ...pending.value, [keyFor(command)]: command }
    return send(command)
  }
  function recover() {
    if (!pendingCommand.value)
      throw new Error('当前没有待核对的原提交')
    return send(pendingCommand.value)
  }
  function cancelRead() {
    sequence += 1
  }
  return { context: readonly(context), saving: readonly(saving), pendingCommand, read, save, recover, cancelRead }
})
