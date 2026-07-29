import type { CustomerDetailSnapshot } from '~/lib/customer/detail'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { loadCustomerDetail } from '~/lib/customer/detail'
import { db } from '~/lib/db/client'

export const useCustomerDetailStore = defineStore('customer-detail', () => {
  const snapshots = shallowRef<Record<string, CustomerDetailSnapshot | null>>({})
  const loadingIds = shallowRef(new Set<string>())
  const inFlight = new Map<string, Promise<CustomerDetailSnapshot | null>>()

  function byCustomer(customerId: string): CustomerDetailSnapshot | null {
    return snapshots.value[customerId] ?? null
  }

  function setLoading(customerId: string, loading: boolean) {
    const next = new Set(loadingIds.value)
    if (loading)
      next.add(customerId)
    else
      next.delete(customerId)
    loadingIds.value = next
  }

  async function load(customerId: string): Promise<CustomerDetailSnapshot | null> {
    const active = inFlight.get(customerId)
    if (active)
      return active

    const task = (async () => {
      setLoading(customerId, true)
      try {
        const snapshot = await loadCustomerDetail(db, customerId)
        snapshots.value = { ...snapshots.value, [customerId]: snapshot }
        return snapshot
      }
      finally {
        setLoading(customerId, false)
      }
    })()
    inFlight.set(customerId, task)
    try {
      return await task
    }
    finally {
      if (inFlight.get(customerId) === task)
        inFlight.delete(customerId)
    }
  }

  return {
    snapshots,
    loadingIds,
    byCustomer,
    load,
  }
})
