import type { OtherSettlementCommand } from '~/lib/other-settlement/contract'
import { defineStore } from 'pinia'

export const useOtherSettlementCommandStore = defineStore('other-settlement-command', () => {
  const pending = new Map<string, {
    fingerprint: string
    commandId: string
  }>()
  async function save(key: string, request: Omit<OtherSettlementCommand, 'commandId'>) {
    const fingerprint = JSON.stringify(request)
    let command = pending.get(key)
    if (!command || command.fingerprint !== fingerprint) {
      command = { fingerprint, commandId: crypto.randomUUID() }
      pending.set(key, command)
    }
    const result = await useNuxtApp().$repositories.otherSettlements.execute({ ...request, commandId: command.commandId })
    pending.delete(key)
    return result
  }
  return { save }
})
