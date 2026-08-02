import type { TargetCostListRow } from '~/lib/target-cost/list'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { getDb } from '~/lib/db/connection'
import { loadTargetCostList } from '~/lib/target-cost/list'
import { toErrorMessage } from '~/lib/util/error'

export const useTargetCostListStore = defineStore('target-cost-list', () => {
  const rows = shallowRef<TargetCostListRow[]>([])
  const loading = shallowRef(false)
  const error = shallowRef('')
  let latestRequest = 0

  async function load() {
    const request = ++latestRequest
    loading.value = true
    error.value = ''
    try {
      const db = await getDb()
      const result = await loadTargetCostList(db)
      if (request === latestRequest)
        rows.value = result
    }
    catch (cause) {
      if (request === latestRequest)
        error.value = toErrorMessage(cause)
    }
    finally {
      if (request === latestRequest)
        loading.value = false
    }
  }

  return {
    rows: readonly(rows),
    loading: readonly(loading),
    error: readonly(error),
    load,
  }
})
