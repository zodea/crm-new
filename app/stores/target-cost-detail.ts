import type { TargetCostDetail } from '~/lib/target-cost/detail'
import type { TargetCostItemDraft } from '~/lib/target-cost/items'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { getDb } from '~/lib/db/connection'
import { loadTargetCostDetail } from '~/lib/target-cost/detail'
import { saveTargetCostItems } from '~/lib/target-cost/items'
import { toErrorMessage } from '~/lib/util/error'

export const useTargetCostDetailStore = defineStore('target-cost-detail', () => {
  const current = shallowRef<TargetCostDetail | null>(null)
  const loadedId = shallowRef('')
  const loading = shallowRef(false)
  const error = shallowRef('')
  const savingItems = shallowRef(false)
  let latestRequest = 0

  async function load(id: string) {
    const request = ++latestRequest
    loading.value = true
    error.value = ''
    try {
      const db = await getDb()
      const detail = await loadTargetCostDetail(db, id)
      if (request !== latestRequest)
        return
      current.value = detail
      loadedId.value = id
    }
    catch (cause) {
      if (request !== latestRequest)
        return
      current.value = null
      loadedId.value = id
      error.value = toErrorMessage(cause)
    }
    finally {
      if (request === latestRequest)
        loading.value = false
    }
  }

  async function saveItems(id: string, items: readonly TargetCostItemDraft[]) {
    savingItems.value = true
    try {
      await saveTargetCostItems(id, items)
      await load(id)
    }
    finally {
      savingItems.value = false
    }
  }

  return {
    current: readonly(current),
    loadedId: readonly(loadedId),
    loading: readonly(loading),
    error: readonly(error),
    savingItems: readonly(savingItems),
    load,
    saveItems,
  }
})
