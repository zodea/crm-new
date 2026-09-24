import type { AuxiliaryContractCommand } from '~/lib/auxiliary-contract/contract'
import { defineStore } from 'pinia'

export const useAuxiliaryContractCommandStore = defineStore('auxiliary-contract-command', () => {
  const pending = new Map<string, { fingerprint: string, commandId: string }>()
  async function save(key: string, request: Omit<AuxiliaryContractCommand, 'commandId'>) {
    const fingerprint = JSON.stringify(request)
    let command = pending.get(key)
    if (!command || command.fingerprint !== fingerprint) {
      command = { fingerprint, commandId: crypto.randomUUID() }
      pending.set(key, command)
    }
    const result = await useNuxtApp().$repositories.auxiliaryContracts.execute({ ...request, commandId: command.commandId })
    pending.delete(key)
    return result
  }
  return { save }
})
