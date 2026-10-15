import type { TargetCostCommandResult, TargetCostDetailRead } from '~/lib/target-cost/central-contract'
import type { TargetCostItemDraft } from '~/lib/target-cost/items'
import type { DataOriginDTO } from '~/types/read-model'
import { defineStore } from 'pinia'
import { localTargetCostDetail } from '~/lib/target-cost/local-read'
import { useDataVisibilityStore } from './data-visibility'
import { useTargetCostStore } from './target-cost'

export const useTargetCostDetailStore = defineStore('target-cost-detail', () => {
  async function loadCentral(id: string, origin: DataOriginDTO = 'real'): Promise<TargetCostDetailRead> {
    if (origin === 'demo') {
      const authorized = await useNuxtApp().$repositories.targetCosts.list({ origin, includeDemo: useDataVisibilityStore().includeDemo })
      return localTargetCostDetail(authorized.context, id)
    }
    return useNuxtApp().$repositories.targetCosts.detail({ origin }, id)
  }
  function saveItems(read: TargetCostDetailRead, items: readonly TargetCostItemDraft[]): Promise<TargetCostCommandResult> {
    return useTargetCostStore().executeAction(read, { kind: 'save-items', items: [...items] })
  }

  return {
    loadCentral,
    getPending: (read: TargetCostDetailRead) => useTargetCostStore().getPending(read),
    recover: (pending: NonNullable<ReturnType<ReturnType<typeof useTargetCostStore>['getPending']>>) => useTargetCostStore().recover(pending),
    saveItems,
  }
})
