import type { TargetCostListRead } from '~/lib/target-cost/central-contract'
import type { TargetCostListRow } from '~/lib/target-cost/list'
import type { DataOriginDTO } from '~/types/read-model'
import { isTauri } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { getDb } from '~/lib/db/connection'
import { loadTargetCostList } from '~/lib/target-cost/list'
import { toErrorMessage } from '~/lib/util/error'
import { useDataVisibilityStore } from './data-visibility'

export const useTargetCostListStore = defineStore('target-cost-list', () => {
  const rows = shallowRef<TargetCostListRow[]>([])
  const loading = shallowRef(false)
  const hasSnapshot = shallowRef(false)
  const error = shallowRef('')
  let latestRequest = 0

  async function load(origin: DataOriginDTO = 'real'): Promise<TargetCostListRead> {
    const request = ++latestRequest
    loading.value = true
    error.value = ''
    try {
      const read: TargetCostListRead = isTauri()
        ? { context: { workspaceId: 'tauri', actorId: 'local', origin: 'real', sourceVersion: 'local', capabilities: ['target-cost:read', 'target-cost:write'] }, rows: await loadTargetCostList(await getDb(), true) }
        : await useNuxtApp().$repositories.targetCosts.list({ origin, includeDemo: useDataVisibilityStore().includeDemo })
      if (!isTauri() && origin === 'demo')
        read.rows = await loadTargetCostList(await getDb())
      if (request === latestRequest) {
        rows.value = read.rows
        hasSnapshot.value = true
      }
      return read
    }
    catch (cause) {
      if (request === latestRequest)
        error.value = toErrorMessage(cause)
      throw cause
    }
    finally {
      if (request === latestRequest)
        loading.value = false
    }
  }

  return {
    rows: readonly(rows),
    loading: readonly(loading),
    hasSnapshot: readonly(hasSnapshot),
    error: readonly(error),
    load,
  }
})
