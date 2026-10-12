<script setup lang="ts">
import type { ContractPriceFact } from '~/lib/material-contract/price-facts'
import type { QuotationRead } from '~/lib/material-quotation/contract'
import type { DeliveryPriceRecordInput, MaterialContractInput, PricePartyInput } from '~/lib/material/price-analysis'
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, shallowRef, watch } from 'vue'
import ContractPriceTable from '~/components/material/price/ContractPriceTable.vue'
import MaterialPriceAnalysisScreen from '~/components/material/price/MaterialPriceAnalysisScreen.vue'
import QuotationPriceTable from '~/components/material/price/QuotationPriceTable.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { readDeliveryMaterialContracts } from '~/lib/delivery-record/material-contracts'
import { bindReadAuthority } from '~/lib/read-model/authority'
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
const priceError = shallowRef('')
const priceRows = shallowRef<readonly ContractPriceFact[] | null>(null)
const quotationRepository = useMaterialQuotationRepository()
const quotationRead = shallowRef<QuotationRead | null>(null)
const quotationError = shallowRef('')
const snapshot = shallowRef<{
  records: readonly DeliveryPriceRecordInput[]
  suppliers: readonly PricePartyInput[]
  projects: readonly PricePartyInput[]
  contracts: readonly MaterialContractInput[]
} | null>(null)
let generation = 0
let active = true
let controller: AbortController | null = null
bindReadAuthority((problem) => {
  generation++
  controller?.abort()
  snapshot.value = null
  priceRows.value = null
  quotationRead.value = null
  quotationError.value = ''
  priceError.value = ''
  loading.value = false
  error.value = problem.message
})

async function refresh() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  const owner = ++generation
  const origin = deliveryStore.origin
  loading.value = true
  error.value = ''
  priceError.value = ''
  quotationRead.value = null
  quotationError.value = ''
  if (central)
    snapshot.value = null
  priceRows.value = null
  try {
    // Publish related sources together; a partial refresh is not a valid analysis.
    const results = await Promise.allSettled([
      deliveryStore.load(),
      supplierStore?.load(),
      projectStore?.load(),
      contractStore?.load(),
      contractRepository ? readDeliveryMaterialContracts(contractRepository, origin, request.signal) : Promise.resolve([]),
      central
        ? contractRepository?.prices ? contractRepository.prices(origin, { signal: request.signal }).then(result => result.items) : Promise.resolve(null)
        : Promise.resolve(null),
      origin === 'real' ? quotationRepository.list() : Promise.resolve(null),
    ] as const)
    if (!active || owner !== generation || request.signal.aborted)
      return
    const prices = results[5]
    const quotations = results[6]
    if (quotations.status === 'fulfilled')
      quotationRead.value = quotations.value
    else quotationError.value = toErrorMessage(quotations.reason)
    if (prices.status === 'fulfilled') {
      priceRows.value = prices.value
    }
    else {
      priceRows.value = null
      priceError.value = toErrorMessage(prices.reason)
    }
    const failure = results.slice(0, 5).find(result => result.status === 'rejected')
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
  quotationRead.value = null
  quotationError.value = ''
  if (central) {
    snapshot.value = null
    priceRows.value = null
    priceError.value = ''
  }
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
  priceRows.value = null
  priceError.value = ''
  quotationRead.value = null
  quotationError.value = ''
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
    <StatePanel v-if="priceError" kind="error" title="合同约定价读取失败" :description="priceError" action-label="重试" @action="refresh" />
    <ContractPriceTable v-if="priceRows" :rows="priceRows" :native="!central" />
    <StatePanel v-if="quotationError" kind="error" title="独立报价读取失败" :description="quotationError" action-label="重试" @action="refresh" />
    <QuotationPriceTable v-if="quotationRead || priceRows || (!loading && !error && snapshot)" :read="quotationRead" :contract-rows="priceRows" :records="!loading && !error ? snapshot?.records : null" :suppliers="!loading && !error ? snapshot?.suppliers : []" :projects="!loading && !error ? snapshot?.projects : []" :native="!central" />
    <p v-if="snapshot && (loading || error)" role="status" class="m-0 border border-warn/30 bg-warn/6 px-3 py-2 text-12px text-ink-soft">
      下方为上次读取的送货价格，仅供查看；本次读取完成前不能作为当前比较或导出依据。
    </p>
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
