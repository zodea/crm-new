import type { PayrollWritableContext } from '~/lib/payroll/central-contract'
import type { PayrollWorkbookCommand } from '~/lib/payroll/central-workbook-contract'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { rosterId, rosterObject } from '~/lib/worker-roster/validation'

interface PendingWorkbook { commandId: string, projectId: string, workspaceId: string, actorId: string }
const KEY = 'ruihang.payroll-workbook.pending.v1'
export const usePayrollWorkbookStore = defineStore('payroll-workbook', () => {
  const repository = useNuxtApp().$repositories.payroll
  const pending = shallowRef<PendingWorkbook | null>(null)
  function restore() {
    if (!import.meta.client || pending.value)
      return
    try {
      const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null')
      if (rosterObject(value) && ['commandId', 'projectId', 'workspaceId', 'actorId'].every(key => rosterId(value[key])))
        pending.value = value as unknown as PendingWorkbook
    }
    catch { /* Only receipt identities are restorable; no payroll or private body is cached. */ }
  }
  async function execute(command: PayrollWorkbookCommand) {
    restore()
    if (pending.value)
      throw new Error('请先核对上一次工资目录保存结果')
    const marker = { commandId: command.commandId, projectId: command.input.projectId, workspaceId: command.workspaceId, actorId: command.actorId }
    sessionStorage.setItem(KEY, JSON.stringify(marker))
    pending.value = marker
    return repository.executeWorkbook(command)
  }
  async function recover(context: PayrollWritableContext) {
    restore()
    const marker = pending.value
    if (!marker)
      return null
    if (marker.workspaceId !== context.workspaceId || marker.actorId !== context.actorId)
      throw new Error('待核对提交属于其他工作区或身份，请切回原身份处理')
    const resolution = await repository.resolveWorkbook(marker.commandId, marker.projectId)
    if (resolution.state === 'applied') {
      const read = await repository.workbookArchive({ origin: 'real', projectId: marker.projectId }, { projectId: marker.projectId, archiveId: resolution.result.archiveId })
      if (read.version !== resolution.result.version || read.manifestHash !== resolution.result.manifestHash || read.context.workspaceId !== marker.workspaceId || read.context.actorId !== marker.actorId)
        throw new Error('原目录尚未按回执完整读回，请稍后核对')
      return { resolution, archive: read }
    }
    return { resolution, archive: null }
  }
  function acknowledge() {
    sessionStorage.removeItem(KEY)
    pending.value = null
  }
  return { repository, pending, restore, execute, recover, acknowledge }
})
