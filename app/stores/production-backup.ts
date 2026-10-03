import type { ProductionBackupAction, ProductionBackupCommand, ProductionBackupRun, ProductionBackupStatus } from '~/lib/production/backup-contract'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { backupPendingKey, clearBackupPending, readBackupPending, saveBackupPending } from '~/lib/production/backup-pending'

export const useProductionBackupStore = defineStore('production-backup', () => {
  const current = shallowRef<ProductionBackupStatus | null>(null)
  const problem = shallowRef('')
  const busy = shallowRef(false)
  const pending = shallowRef<ProductionBackupCommand | null>(null)
  const lastResult = shallowRef<ProductionBackupRun | null>(null)
  const repository = () => useNuxtApp().$repositories.productionBackup
  let generation = 0
  const message = (cause: unknown) => (cause as { data?: { data?: { message?: string } } })?.data?.data?.message ?? (cause instanceof Error ? cause.message : '备份状态暂不可用，请重新核对。')
  async function refresh() {
    const token = ++generation
    try {
      const next = await repository().status()
      if (token !== generation)
        return
      current.value = next
      pending.value = readBackupPending(backupPendingKey(next))
      problem.value = ''
    }
    catch (cause) {
      if (token === generation)
        problem.value = message(cause)
    }
  }
  async function perform(action?: ProductionBackupAction) {
    if (busy.value || !current.value)
      return
    busy.value = true
    generation++
    problem.value = ''
    const scope = current.value
    const key = backupPendingKey(scope)
    try {
      let command = readBackupPending(key)
      if (!command) {
        if (!action || (action !== 'backup' && !scope.latest?.packageId))
          throw new Error('请先建立成功的主备份。')
        command = { commandId: crypto.randomUUID(), action, sourceBackupId: action === 'backup' ? null : scope.latest!.packageId }
        saveBackupPending(key, command)
      }
      pending.value = command
      const result = await repository().execute(command)
      lastResult.value = result
      if (result.state !== 'running') {
        clearBackupPending(key, command.commandId)
        pending.value = null
      }
      await refresh()
    }
    catch (cause) { problem.value = message(cause) }
    finally { busy.value = false }
  }
  return { current: readonly(current), problem: readonly(problem), busy: readonly(busy), pending: readonly(pending), lastResult: readonly(lastResult), refresh, perform }
})
