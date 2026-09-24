<script setup lang="ts">
import type { DeliveryPriceRecordInput, MaterialContractInput, PricePartyInput } from '~/lib/material/price-analysis'
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch } from 'vue'
import MaterialPriceAnalysisScreen from '~/components/material/price/MaterialPriceAnalysisScreen.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { readDeliveryMaterialContracts } from '~/lib/delivery-record/material-contracts'
import { toErrorMessage } from '~/lib/util/error'
import { useContractStore } from '~/stores/contract'
import { useDeliveryRecordStore } from '~/stores/delivery-record'
import { useProjectStore } from '~/stores/project'
import { useSupplierStore } from '~/stores/supplier'

const deliveryStore = useDeliveryRecordStore()
const central = deliveryStore.mode === 'central'
const supplierStore = central ? null : useSupplierStore()
const projectStore = central ? null : useProjectStore()
const contractStore = central ? null : useContractStore()
const contractRepository = central ? useNuxtApp().$repositories.materialContractRead : null

const loading = shallowRef(true)
const error = shallowRef('')
const snapshot = shallowRef<{
  records: readonly DeliveryPriceRecordInput[]
  suppliers: readonly PricePartyInput[]
  projects: readonly PricePartyInput[]
  contracts: readonly MaterialContractInput[]
} | null>(null)
let generation = 0
let active = true
let controller: AbortController | null = null

async function refresh() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  const owner = ++generation
  const origin = deliveryStore.origin
  loading.value = true
  error.value = ''
  if (central)
    snapshot.value = null
  try {
    // Publish related sources together; a partial refresh is not a valid analysis.
    const results = await Promise.allSettled([
      deliveryStore.load(),
      supplierStore?.load(),
      projectStore?.load(),
      contractStore?.load(),
      contractRepository ? readDeliveryMaterialContracts(contractRepository, origin, request.signal) : Promise.resolve([]),
    ] as const)
    if (!active || owner !== generation || request.signal.aborted)
      return
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected')
      throw failure.reason
    const contracts = results[4]
    snapshot.value = {
      records: [...deliveryStore.list],
      suppliers: central ? [...deliveryStore.context?.suppliers ?? []] : [...supplierStore?.list ?? []],
      projects: central ? [...deliveryStore.context?.projects ?? []] : [...projectStore?.list ?? []],
      contracts: central && contracts?.status === 'fulfilled' ? contracts.value ?? [] : [...contractStore?.list ?? []],
    }
  }
  catch (cause) {
    if (active && owner === generation && !request.signal.aborted)
      error.value = toErrorMessage(cause)
  }
  finally {
    if (owner === generation)
      loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
function deactivate() {
  active = false
  generation++
  controller?.abort()
  if (central)
    snapshot.value = null
}
onActivated(() => {
  if (!active) {
    active = true
    void refresh()
  }
})
onDeactivated(deactivate)
onBeforeUnmount(deactivate)
watch(() => deliveryStore.origin, () => {
  controller?.abort()
  snapshot.value = null
  if (active)
    void refresh()
}, { flush: 'sync' })
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
      :origin="central ? deliveryStore.origin : undefined"
    />
  </div>
</template>
