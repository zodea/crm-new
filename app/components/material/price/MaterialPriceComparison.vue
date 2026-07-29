<script setup lang="ts">
import type { MaterialPriceComparison } from '~/lib/material/price-analysis'
import { computed } from 'vue'

const props = defineProps<{
  rows: readonly MaterialPriceComparison[]
}>()

const maxPrice = computed(() => Math.max(...props.rows.map(row => row.price), 1))

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
</script>

<template>
  <div class="price-comparison" role="list" aria-label="厂家最新价">
    <div v-for="row in rows" :key="row.supplierId" role="listitem" class="price-comparison__row">
      <div class="price-comparison__meta">
        <span class="truncate font-700 text-ink">{{ row.supplierName }}</span>
        <span class="font-mono text-13px" :class="row.isLowest ? 'text-ok font-800' : 'text-ink'">
          {{ money(row.price) }}
        </span>
      </div>
      <div class="price-comparison__track" aria-hidden="true">
        <span
          class="price-comparison__bar"
          :class="{ 'price-comparison__bar--lowest': row.isLowest }"
          :style="{ width: `${Math.max(8, row.price / maxPrice * 100)}%` }"
        />
      </div>
      <div class="price-comparison__source">
        <span>{{ row.date }} · {{ row.projectName }}</span>
        <NuxtLink :to="`/material/delivery/archive/${row.deliveryRecordId}`" class="text-brand hover:underline">
          来源 {{ row.deliveryOrderNo }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.price-comparison {
  display: grid;
  gap: 1px;
  background: var(--line);
}

.price-comparison__row {
  display: grid;
  grid-template-columns: minmax(150px, 220px) minmax(180px, 1fr) minmax(220px, 300px);
  align-items: center;
  gap: 14px;
  background: var(--panel);
  padding: 10px 12px;
}

.price-comparison__meta,
.price-comparison__source {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.price-comparison__source {
  color: var(--ink-soft);
}

.price-comparison__track {
  height: 10px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--surface-3);
}

.price-comparison__bar {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--brand);
}

.price-comparison__bar--lowest {
  background: var(--ok);
}

@media (max-width: 800px) {
  .price-comparison__row {
    grid-template-columns: 1fr;
    gap: 7px;
  }
}
</style>
