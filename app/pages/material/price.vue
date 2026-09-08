<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import MaterialPriceAnalysisScreen from '~/components/material/price/MaterialPriceAnalysisScreen.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { toErrorMessage } from '~/lib/util/error'
import { useContractStore } from '~/stores/contract'
import { useDeliveryRecordStore } from '~/stores/delivery-record'
import { useProjectStore } from '~/stores/project'
import { useSupplierStore } from '~/stores/supplier'

const deliveryStore = useDeliveryRecordStore()
const supplierStore = useSupplierStore()
const projectStore = useProjectStore()
const contractStore = useContractStore()

const loading = shallowRef(true)
const error = shallowRef('')
const snapshot = shallowRef<{
  records: typeof deliveryStore.list
  suppliers: typeof supplierStore.list
  projects: typeof projectStore.list
  contracts: typeof contractStore.list
} | null>(null)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    // Publish related sources together; a partial refresh is not a valid analysis.
    const results = await Promise.allSettled([
      deliveryStore.load(),
      supplierStore.load(),
      projectStore.load(),
      contractStore.load(),
    ])
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected')
      throw failure.reason
    snapshot.value = {
      records: [...deliveryStore.list],
      suppliers: [...supplierStore.list],
      projects: [...projectStore.list],
      contracts: [...contractStore.list],
    }
  }
  catch (cause) {
    error.value = toErrorMessage(cause)
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="grid min-w-0 gap-3" :aria-busy="loading">
    <div v-if="snapshot" class="flex justify-end">
      <button type="button" class="btn-secondary" :disabled="loading" @click="refresh">
        <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="{ 'animate-spin': loading }" aria-hidden="true" />
        刷新分析
      </button>
    </div>
    <StatePanel
      v-if="error"
      kind="error"
      title="材料单价分析读取失败"
      :description="error"
      :compact="!!snapshot"
      action-label="重试"
      @action="refresh"
    />
    <StatePanel
      v-else-if="loading && !snapshot"
      kind="loading"
      title="正在读取已归档送货单价格…"
    />
    <MaterialPriceAnalysisScreen
      v-if="snapshot"
      :records="snapshot.records"
      :suppliers="snapshot.suppliers"
      :projects="snapshot.projects"
      :contracts="snapshot.contracts"
    />
  </div>
</template>
