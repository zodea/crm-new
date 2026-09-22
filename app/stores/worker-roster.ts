import type { WorkerRosterCommand, WorkerRosterContext } from '~/lib/worker-roster/contract'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { rosterId, rosterObject } from '~/lib/worker-roster/validation'

interface PendingRosterCommand { commandId: string, action: WorkerRosterCommand['action'], workspaceId: string, actorId: string, workerId: string | null, projectId: string | null }
const KEY = 'ruihang.worker-roster.pending.v1'
export const useWorkerRosterStore = defineStore('worker-roster', () => {
  const repository = useNuxtApp().$repositories.workerRoster
  const pending = shallowRef<PendingRosterCommand | null>(null)
  function restore() {
    if (!import.meta.client || pending.value)
      return
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
      if (rosterObject(value) && rosterId(value.commandId) && rosterId(value.workspaceId) && rosterId(value.actorId) && ((value.action === 'archive' && rosterId(value.projectId) && value.workerId === null) || (value.action === 'save-profile' && rosterId(value.workerId) && value.projectId === null)))
        pending.value = value as unknown as PendingRosterCommand
    }
    catch { /* No private profile, photo body or frozen roster is persisted in the browser. */ }
  }
  async function execute(command: WorkerRosterCommand) {
    restore()
    if (pending.value)
      throw new Error('请先核对上一次名册资料提交的结果')
    const marker: PendingRosterCommand = { commandId: command.commandId, action: command.action, workspaceId: command.workspaceId, actorId: command.actorId, workerId: command.action === 'save-profile' ? command.workerId : null, projectId: command.action === 'archive' ? command.scope.projectId : null }
    // Persist only the receipt identity before dispatch. If storage fails, no command is sent.
    sessionStorage.setItem(KEY, JSON.stringify(marker))
    pending.value = marker
    return repository.execute(command)
  }
  async function resolve(context: WorkerRosterContext) {
    restore()
    const marker = pending.value
    if (!marker)
      return null
    if (marker.workspaceId !== context.workspaceId || marker.actorId !== context.actorId)
      throw new Error('待核对操作属于其他工作区或身份，请切回原身份处理')
    const outcome = await repository.resolve(marker.commandId, marker.action)
    if (outcome.state === 'applied') {
      if (marker.action === 'save-profile') {
        const read = await repository.profile(marker.workerId!)
        if (outcome.result.workerId !== read.worker.id || read.revision < outcome.result.revision)
          throw new Error('原提交尚未从工人资料中读回，请稍后核对')
      }
      else {
        const read = await repository.archive(marker.projectId!, outcome.result.archiveId ?? '')
        if (read.version !== outcome.result.revision)
          throw new Error('原提交尚未从名册归档中读回，请稍后核对')
      }
    }
    return outcome
  }
  function acknowledge() {
    sessionStorage.removeItem(KEY)
    pending.value = null
  }
  return { repository, pending, restore, execute, resolve, acknowledge }
})
