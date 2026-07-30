import type { ContractDetailSnapshot } from '~/lib/contract/detail'
import type { ContractKind } from '~/lib/contract/status'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { loadContractDetailSnapshot } from '~/lib/contract/detail'

export const useContractDetailStore = defineStore('contract-detail', () => {
  const snapshots = shallowRef<Record<string, ContractDetailSnapshot>>({})
  const loadingIds = shallowRef<ReadonlySet<string>>(new Set())
  const inFlight = new Map<string, Promise<ContractDetailSnapshot>>()

  function byContract(contractId: string): ContractDetailSnapshot | null {
    return snapshots.value[contractId] ?? null
  }

  function isLoading(contractId: string): boolean {
    return loadingIds.value.has(contractId)
  }

  function clear(contractId: string) {
    if (!snapshots.value[contractId])
      return
    const next = { ...snapshots.value }
    delete next[contractId]
    snapshots.value = next
  }

  function setLoading(contractId: string, loading: boolean) {
    const next = new Set(loadingIds.value)
    if (loading)
      next.add(contractId)
    else
      next.delete(contractId)
    loadingIds.value = next
  }

  async function load(
    contractId: string,
    kind: ContractKind,
  ): Promise<ContractDetailSnapshot> {
    const running = inFlight.get(contractId)
    if (running)
      return running

    const task = (async () => {
      setLoading(contractId, true)
      try {
        const snapshot = await loadContractDetailSnapshot(contractId, kind)
        snapshots.value = { ...snapshots.value, [contractId]: snapshot }
        return snapshot
      }
      finally {
        setLoading(contractId, false)
      }
    })()
    inFlight.set(contractId, task)
    try {
      return await task
    }
    finally {
      if (inFlight.get(contractId) === task)
        inFlight.delete(contractId)
    }
  }

  return {
    snapshots: readonly(snapshots),
    byContract,
    clear,
    isLoading,
    load,
  }
})
