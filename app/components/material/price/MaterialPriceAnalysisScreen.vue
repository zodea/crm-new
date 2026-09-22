<script setup lang="ts">
import type {
  DeliveryPriceRecordInput,
  MaterialContractInput,
  PricePartyInput,
} from '~/lib/material/price-analysis'
import { computed, shallowRef, watch } from 'vue'
import {
  calculateOfficialMarketDeviation,
  officialMaterialPriceSeries,
} from '~/lib/material/official-price-source'
import {
  analyzeMaterialPrices,
  buildMaterialPriceCatalog,
  buildSupplierContractRows,
} from '~/lib/material/price-analysis'
import MaterialPriceComparison from './MaterialPriceComparison.vue'
import MaterialPricePicker from './MaterialPricePicker.vue'
import MaterialPriceTrendChart from './MaterialPriceTrendChart.vue'
import OfficialMaterialPricePanel from './OfficialMaterialPricePanel.vue'
import SupplierContractTable from './SupplierContractTable.vue'

const props = withDefaults(defineProps<{
  records: readonly DeliveryPriceRecordInput[]
  suppliers: readonly PricePartyInput[]
  projects: readonly PricePartyInput[]
  contracts: readonly MaterialContractInput[]
  loading?: boolean
  origin?: 'real' | 'demo'
}>(), {
  loading: false,
})

const selectedKey = shallowRef('')
const selectedSupplierIds = shallowRef<string[]>([])

const catalog = computed(() =>
  buildMaterialPriceCatalog(props.records, props.suppliers, props.projects),
)
const selectedMaterial = computed(() =>
  catalog.value.find(material => material.key === selectedKey.value) ?? null,
)
const availableSuppliers = computed(() => {
  if (!selectedMaterial.value)
    return []
  const byId = new Map<string, string>()
  for (const fact of selectedMaterial.value.facts)
    byId.set(fact.supplierId, fact.supplierName)
  return [...byId].map(([id, name]) => ({ id, name }))
})
const analysis = computed(() =>
  selectedMaterial.value
    ? analyzeMaterialPrices(selectedMaterial.value, selectedSupplierIds.value)
    : null,
)
const officialSeries = computed(() =>
  selectedMaterial.value
    ? officialMaterialPriceSeries(selectedMaterial.value)
    : null,
)
const officialDeviation = computed(() =>
  calculateOfficialMarketDeviation(
    analysis.value?.medianPrice ?? null,
    officialSeries.value,
  ),
)
const showsTrend = computed(() =>
  analysis.value?.mode === 'trend' || officialSeries.value != null,
)
const contractRows = computed(() =>
  selectedMaterial.value
    ? buildSupplierContractRows(
        [...new Set(selectedMaterial.value.facts.map(fact => fact.supplierId))],
        props.contracts,
        props.suppliers,
        props.projects,
      )
    : [],
)
const sourceFacts = computed(() =>
  selectedMaterial.value
    ? [...selectedMaterial.value.facts].sort((a, b) => b.date.localeCompare(a.date))
    : [],
)

watch(catalog, (materials) => {
  if (!materials.some(material => material.key === selectedKey.value))
    selectedKey.value = materials[0]?.key ?? ''
}, { immediate: true })

watch(selectedMaterial, (material) => {
  selectedSupplierIds.value = material
    ? [...new Set(material.facts.map(fact => fact.supplierId))].slice(0, 4)
    : []
})

function toggleSupplier(supplierId: string) {
  const selected = selectedSupplierIds.value
  if (selected.includes(supplierId)) {
    if (selected.length > 1)
      selectedSupplierIds.value = selected.filter(id => id !== supplierId)
    return
  }
  if (selected.length < 4)
    selectedSupplierIds.value = [...selected, supplierId]
}

function money(value: number | null): string {
  if (value == null)
    return '—'
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
</script>

<template>
  <div class="material-price-screen">
    <div v-if="loading" role="status" class="panel px-4 py-10 text-center text-13px text-ink-soft">
      正在读取已归档送货单价格…
    </div>

    <div v-else-if="!catalog.length" role="status" class="panel px-5 py-14 text-center">
      <span class="i-lucide-database-zap mb-3 text-28px text-ink-faint" />
      <h2 class="text-15px font-800 text-ink">
        尚无可分析的材料价格
      </h2>
      <p class="mx-auto mt-2 max-w-110 text-12px leading-5 text-ink-soft">
        单价对比只读取已归档送货单明细；分供方未明确、单价为空及运费类费用行不会进入分析。
      </p>
      <NuxtLink :to="`/material/delivery/archive${origin ? `?origin=${origin}` : ''}`" class="btn-primary mt-4">
        查看送货单归档库
      </NuxtLink>
    </div>

    <template v-else>
      <div class="material-price-screen__workspace">
        <MaterialPricePicker v-model="selectedKey" :materials="catalog" />

        <main v-if="selectedMaterial && analysis" class="min-w-0">
          <section class="panel overflow-hidden">
            <header class="material-price-screen__header">
              <div class="min-w-0">
                <p class="text-11px font-700 text-brand">
                  材料单价分析
                </p>
                <h1 class="mt-1 truncate text-17px font-800 text-ink">
                  {{ selectedMaterial.name }}<template v-if="selectedMaterial.spec">
                    · {{ selectedMaterial.spec }}
                  </template>
                </h1>
                <p class="mt-1 text-12px text-ink-soft">
                  单位 {{ selectedMaterial.unit }} · {{ availableSuppliers.length }} 家厂家 · {{ selectedMaterial.facts.length }} 个价格点
                </p>
                <p class="mt-1 text-11px text-ink-faint">
                  {{ selectedMaterial.category.order === 99
                    ? selectedMaterial.category.name
                    : `官方材料第 ${selectedMaterial.category.order} 类 · ${selectedMaterial.category.name}` }}
                </p>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <span class="chip-brand">
                  {{ showsTrend ? (officialSeries ? '官方与市场趋势' : '价格趋势') : '厂家最新价对比' }}
                </span>
                <NuxtLink :to="`/material/delivery/archive${origin ? `?origin=${origin}` : ''}`" class="btn-secondary">
                  数据来源：已归档送货单
                </NuxtLink>
              </div>
            </header>

            <div class="material-price-screen__stats">
              <div class="info-cell">
                <span class="text-11px text-ink-soft">最低价</span>
                <strong class="mt-1 block font-mono text-15px text-ok">{{ money(analysis.lowestPrice) }}</strong>
              </div>
              <div class="info-cell">
                <span class="text-11px text-ink-soft">中位价</span>
                <strong class="mt-1 block font-mono text-15px text-ink">{{ money(analysis.medianPrice) }}</strong>
              </div>
              <div class="info-cell">
                <span class="text-11px text-ink-soft">价差</span>
                <strong class="mt-1 block font-mono text-15px text-warn">{{ money(analysis.spread) }}</strong>
              </div>
              <div class="info-cell">
                <span class="text-11px text-ink-soft">最近价格日期</span>
                <strong class="mt-1 block font-mono text-15px text-ink">{{ sourceFacts[0]?.date || '—' }}</strong>
              </div>
            </div>

            <OfficialMaterialPricePanel
              :category="selectedMaterial.category"
              :series="officialSeries"
              :deviation="officialDeviation"
            />

            <div v-if="showsTrend" class="border-t border-line">
              <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
                <span class="mr-1 text-11px font-700 text-ink-soft">趋势厂家（最多 4 家）</span>
                <button
                  v-for="supplier in availableSuppliers"
                  :key="supplier.id"
                  type="button"
                  class="chip cursor-pointer border"
                  :class="selectedSupplierIds.includes(supplier.id) ? 'border-brand bg-brand-soft text-brand-deep' : 'border-line bg-panel text-ink-soft'"
                  :aria-pressed="selectedSupplierIds.includes(supplier.id)"
                  @click="toggleSupplier(supplier.id)"
                >
                  {{ supplier.name }}
                </button>
              </div>
              <MaterialPriceTrendChart
                :material="selectedMaterial"
                :series="analysis.series"
                :official-series="officialSeries"
              />
            </div>

            <MaterialPriceComparison
              v-else
              class="border-t border-line"
              :rows="analysis.comparisons"
            />

            <details class="border-t border-line">
              <summary class="cursor-pointer px-3 py-2 text-12px font-700 text-ink-soft">
                查看全部 {{ sourceFacts.length }} 个价格来源
              </summary>
              <div class="grid gap-1 border-t border-line bg-surface-2 p-2 sm:grid-cols-2">
                <NuxtLink
                  v-for="fact in sourceFacts"
                  :key="fact.id"
                  :to="`/material/delivery/archive/${encodeURIComponent(fact.deliveryRecordId)}${fact.dataOrigin ? `?origin=${fact.dataOrigin}` : ''}`"
                  class="flex min-w-0 items-center justify-between gap-2 border border-line bg-panel px-2.5 py-2 text-11px hover:border-brand"
                >
                  <span class="truncate">{{ fact.supplierName }} · {{ fact.projectName }}</span>
                  <span class="shrink-0 font-mono text-brand">{{ fact.deliveryOrderNo }} · {{ money(fact.price) }}</span>
                </NuxtLink>
              </div>
            </details>
          </section>
        </main>
      </div>

      <SupplierContractTable :rows="contractRows" />
    </template>
  </div>
</template>

<style scoped>
.material-price-screen {
  display: grid;
  gap: 12px;
}

.material-price-screen__workspace {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.material-price-screen__header {
  display: flex;
  min-height: 82px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
}

.material-price-screen__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  border-top: 1px solid var(--line);
  background: var(--line);
}

@media (max-width: 1024px) {
  .material-price-screen__workspace {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .material-price-screen__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .material-price-screen__workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .material-price-screen__stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
