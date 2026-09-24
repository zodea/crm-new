import type { TargetCostCommandResult, TargetCostDetailRead } from '~/lib/target-cost/central-contract'
import type { TargetCostDetail } from '~/lib/target-cost/detail'
import type { TargetCostItemDraft } from '~/lib/target-cost/items'
import type { DataOriginDTO } from '~/types/read-model'
import { isTauri } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { getDb } from '~/lib/db/connection'
import { targetCostProblem } from '~/lib/target-cost/central-contract'
import { loadTargetCostDetail } from '~/lib/target-cost/detail'
import { saveTargetCostItems } from '~/lib/target-cost/items'
import { localTargetCostDetail } from '~/lib/target-cost/local-read'
import { toErrorMessage } from '~/lib/util/error'
import { useDataVisibilityStore } from './data-visibility'
import { useTargetCostStore } from './target-cost'

export const useTargetCostDetailStore = defineStore('target-cost-detail', () => {
  const current = shallowRef<TargetCostDetail | null>(null)
  const loadedId = shallowRef('')
  const loading = shallowRef(false)
  const error = shallowRef('')
  const savingItems = shallowRef(false)
  let latestRequest = 0

  async function load(id: string) {
    if (!isTauri())
      throw targetCostProblem('forbidden', '正式浏览器预算详情须通过中央读取')
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

  async function loadCentral(id: string, origin: DataOriginDTO = 'real'): Promise<TargetCostDetailRead> {
    if (origin === 'demo') {
      const authorized = await useNuxtApp().$repositories.targetCosts.list({ origin, includeDemo: useDataVisibilityStore().includeDemo })
      return localTargetCostDetail(authorized.context, id)
    }
    return useNuxtApp().$repositories.targetCosts.detail({ origin }, id)
  }
  function saveItems(read: TargetCostDetailRead, items: readonly TargetCostItemDraft[]): Promise<TargetCostCommandResult>
  function saveItems(id: string, items: readonly TargetCostItemDraft[]): Promise<void>
  async function saveItems(read: string | TargetCostDetailRead, items: readonly TargetCostItemDraft[]): Promise<TargetCostCommandResult | void> {
    if (typeof read !== 'string')
      return useTargetCostStore().executeAction(read, { kind: 'save-items', items: [...items] })
    if (!isTauri())
      throw targetCostProblem('forbidden', '正式浏览器明细必须使用读取时固定的预算版本')
    savingItems.value = true
    try {
      await saveTargetCostItems(read, items)
      await load(read)
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
    loadCentral,
    getPending: (read: TargetCostDetailRead) => useTargetCostStore().getPending(read),
    recover: (pending: NonNullable<ReturnType<ReturnType<typeof useTargetCostStore>['getPending']>>) => useTargetCostStore().recover(pending),
    saveItems,
  }
})
