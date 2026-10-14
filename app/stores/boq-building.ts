import type { BoqBuildingCommand, BoqBuildingContext, BoqBuildingQuery } from '~/lib/boq/central-building-contract'
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { useSessionStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, readonly, shallowRef } from 'vue'
import { readBoqRecoveryForRoute } from '~/lib/boq/command-recovery'
import { createProductionBoqRepository } from '~/lib/boq/production-repository'
import { commandRecoveryKey, createCommandRecoveryStorage } from '~/lib/forms/command-recovery'
import { projectProblemFromUnknown } from '~/lib/project/repository'
import { generateId } from '~/lib/util/id'

export const useBoqBuildingStore = defineStore('boq-building-evidence', () => {
  const context = shallowRef<BoqBuildingContext | null>(null)
  const saving = shallowRef(false)
  const pending = useSessionStorage<Record<string, BoqBuildingCommand>>('ruihang:boq-building-pending-v1', {})
  const repository = () => useNuxtApp().$repositories.boqBuilding
  const central = createProductionBoqRepository((url, options) => $fetch<unknown, string>(url, { ...options, retry: 0 }))
  const codec = createCommandRecoveryStorage()
  const formalPending = shallowRef<CommandRecoveryDescriptor | null>(null)
  const formalSaved = shallowRef<string[]>([])
  let sequence = 0
  let target = ''
  const keyFor = (value: Pick<BoqBuildingContext, 'workspaceId' | 'actorId' | 'origin' | 'projectId' | 'contractId'>) => JSON.stringify([value.workspaceId, value.actorId, value.origin, value.projectId, value.contractId])
  const pendingCommand = computed(() => context.value?.contractVersion ? formalPending.value : context.value ? pending.value[keyFor(context.value)] ?? null : null)
  const knownSaved = computed(() => !!formalPending.value && formalSaved.value.includes(formalPending.value.commandId))

  async function read(query: BoqBuildingQuery) {
    const request = ++sequence
    const requested = JSON.stringify(query)
    if (target !== requested) {
      context.value = null
      saving.value = false
    }
    target = requested
    const value = await repository().read(query)
    if (request === sequence && requested === target) {
      context.value = value
      formalPending.value = value.contractVersion ? readBoqRecoveryForRoute(`/contract/boq/building-evidence?project=${encodeURIComponent(value.projectId)}&contract=${encodeURIComponent(value.contractId)}&origin=real`, value, sessionStorage).find(row => row.action === 'correct-building') ?? null : null
    }
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
    const command: BoqBuildingCommand = { commandId: generateId('boq-building-command'), workspaceId: value.workspaceId, actorId: value.actorId, projectId: value.projectId, contractId: value.contractId, origin: value.origin, requiredCapability: 'owner-document:write', sourceVersion: value.sourceVersion, lineId, buildingId, reason, ...(value.contractVersion ? { contractVersion: value.contractVersion, lineVersion: value.lines.find(row => row.id === lineId)?.version, buildingVersion: value.buildings.find(row => row.id === buildingId)?.version } : {}) }
    if (value.contractVersion) {
      const key = keyFor(command)
      const request = sequence
      const descriptor: CommandRecoveryDescriptor = { commandId: command.commandId, workspaceId: command.workspaceId, actorId: command.actorId, family: 'boq', targetId: lineId, action: 'correct-building', scopeId: `${command.projectId}:${command.contractId}` }
      codec.remember(commandRecoveryKey(descriptor), descriptor)
      formalPending.value = descriptor
      saving.value = true
      return repository().execute(command).then(async (result) => {
        formalSaved.value = [...new Set([...formalSaved.value, command.commandId])]
        if (request !== sequence || !context.value || key !== keyFor(context.value))
          return result
        const fresh = await read({ projectId: command.projectId, contractId: command.contractId, origin: 'real' })
        if (fresh.lines.find(row => row.id === lineId)?.building !== result.building || !fresh.audit.some(row => row.id === result.auditId && row.commandId === command.commandId && row.lineId === lineId && row.buildingId === buildingId))
          throw new Error('原更正已应用，但原清单声明未完整读回，保留原编号')
        codec.clear(commandRecoveryKey(descriptor), descriptor.commandId)
        formalSaved.value = formalSaved.value.filter(id => id !== descriptor.commandId)
        if (formalPending.value?.commandId === descriptor.commandId)
          formalPending.value = null
        return result
      }).finally(() => {
        if (context.value && key === keyFor(context.value))
          saving.value = false
      })
    }
    pending.value = { ...pending.value, [keyFor(command)]: command }
    return send(command)
  }
  function recover() {
    if (!pendingCommand.value)
      throw new Error('当前没有待核对的原提交')
    if (context.value?.contractVersion && formalPending.value) {
      const descriptor = formalPending.value
      const original = context.value
      const key = keyFor(original)
      const request = sequence
      saving.value = true
      return central.resolve(descriptor).then(async (resolution) => {
        if (resolution.outcome === 'not-applied') {
          codec.clear(commandRecoveryKey(descriptor), descriptor.commandId)
          if (formalPending.value?.commandId === descriptor.commandId)
            formalPending.value = null
          throw new Error('原更正已核查未应用，原清单保持原值；可用新编号重新核对')
        }
        const result = resolution.result.buildingResult
        if (!result)
          throw new Error('原更正回执没有真实楼栋结果，保留原编号')
        formalSaved.value = [...new Set([...formalSaved.value, descriptor.commandId])]
        if (request !== sequence || !context.value || key !== keyFor(context.value))
          return result
        const fresh = await read({ projectId: original.projectId, contractId: original.contractId, origin: 'real' })
        if (fresh.lines.find(row => row.id === result.lineId)?.building !== result.building || !fresh.audit.some(row => row.id === result.auditId && row.commandId === descriptor.commandId && row.lineId === result.lineId && row.buildingId === result.buildingId))
          throw new Error('原更正已应用但读取未完成，保留原编号')
        codec.clear(commandRecoveryKey(descriptor), descriptor.commandId)
        formalSaved.value = formalSaved.value.filter(id => id !== descriptor.commandId)
        if (formalPending.value?.commandId === descriptor.commandId)
          formalPending.value = null
        return result
      }).finally(() => {
        if (context.value && key === keyFor(context.value))
          saving.value = false
      })
    }
    return send(pendingCommand.value as BoqBuildingCommand)
  }
  function cancelRead() {
    sequence += 1
  }
  return { context: readonly(context), saving: readonly(saving), pendingCommand, knownSaved, read, save, recover, cancelRead }
})
