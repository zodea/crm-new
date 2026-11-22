<script setup lang="ts">
import type { OfficialMaterialPriceSeries } from '~/lib/material/official-price-source'
import type {
  MaterialPriceCatalogItem,
  MaterialPriceSeries,
} from '~/lib/material/price-analysis'
import { computed } from 'vue'

const props = defineProps<{
  material: MaterialPriceCatalogItem
  series: readonly MaterialPriceSeries[]
  officialSeries?: OfficialMaterialPriceSeries | null
}>()

const WIDTH = 760
const HEIGHT = 280
const PADDING = { top: 22, right: 24, bottom: 42, left: 64 }
const COLORS = ['#3976c6', '#10a878', '#f59e0b', '#7c5ce7']

interface ChartPoint {
  id: string
  date: string
  price: number
}

interface ChartLine {
  id: string
  label: string
  kind: 'market' | 'official'
  points: ChartPoint[]
}

const allSeries = computed<ChartLine[]>(() => {
  const market = props.series.map(series => ({
    id: series.supplierId,
    label: series.supplierName,
    kind: 'market' as const,
    points: series.points,
  }))
  const official = props.officialSeries
    ? [{
        id: props.officialSeries.identity.lookupKey,
        label: '广州官方信息价',
        kind: 'official' as const,
        points: props.officialSeries.points,
      }]
    : []
  return [...market, ...official]
})
const dates = computed(() =>
  [...new Set(allSeries.value.flatMap(series => series.points.map(point => point.date)))].sort(),
)
const prices = computed(() => allSeries.value.flatMap(series => series.points.map(point => point.price)))
const minPrice = computed(() => Math.min(...prices.value))
const maxPrice = computed(() => Math.max(...prices.value))
const priceSpan = computed(() => Math.max(maxPrice.value - minPrice.value, Math.max(maxPrice.value * 0.08, 1)))
const chartMin = computed(() => Math.max(0, minPrice.value - priceSpan.value * 0.12))
const chartMax = computed(() => maxPrice.value + priceSpan.value * 0.12)

function xFor(date: string): number {
  const index = dates.value.indexOf(date)
  const slots = Math.max(dates.value.length - 1, 1)
  return PADDING.left + index * ((WIDTH - PADDING.left - PADDING.right) / slots)
}

function yFor(price: number): number {
  const span = Math.max(chartMax.value - chartMin.value, 1)
  return PADDING.top + (chartMax.value - price) / span * (HEIGHT - PADDING.top - PADDING.bottom)
}

function pointsFor(series: ChartLine): string {
  return series.points.map(point => `${xFor(point.date)},${yFor(point.price)}`).join(' ')
}

function colorFor(line: ChartLine, index: number): string {
  return line.kind === 'official' ? '#172033' : COLORS[index % COLORS.length]!
}

function money(value: number): string {
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
</script>

<template>
  <div class="price-chart">
    <div class="price-chart__legend" aria-label="价格趋势图例">
      <span v-for="(line, index) in allSeries" :key="line.id" class="price-chart__legend-item">
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="{ 'ring-1 ring-offset-1 ring-ink': line.kind === 'official' }"
          :style="{ backgroundColor: colorFor(line, index) }"
        />
        {{ line.label }}
      </span>
    </div>

    <div
      class="overflow-x-auto"
      data-testid="material-price-trend-scroll"
      tabindex="0"
      aria-label="价格趋势图横向滚动区"
    >
      <svg
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
        role="img"
        :aria-label="`${material.name}${material.spec ? ` ${material.spec}` : ''} 价格趋势图`"
        class="block min-w-[620px] w-full"
      >
        <line
          v-for="tick in 5"
          :key="`grid-${tick}`"
          :x1="PADDING.left"
          :x2="WIDTH - PADDING.right"
          :y1="PADDING.top + (tick - 1) * ((HEIGHT - PADDING.top - PADDING.bottom) / 4)"
          :y2="PADDING.top + (tick - 1) * ((HEIGHT - PADDING.top - PADDING.bottom) / 4)"
          stroke="var(--line)"
          stroke-width="1"
        />
        <text
          v-for="tick in 5"
          :key="`axis-${tick}`"
          :x="PADDING.left - 10"
          :y="PADDING.top + (tick - 1) * ((HEIGHT - PADDING.top - PADDING.bottom) / 4) + 4"
          text-anchor="end"
          fill="var(--ink-soft)"
          font-size="11"
        >
          {{ money(chartMax - (tick - 1) * ((chartMax - chartMin) / 4)) }}
        </text>
        <text
          v-for="date in dates"
          :key="date"
          :x="xFor(date)"
          :y="HEIGHT - 16"
          text-anchor="middle"
          fill="var(--ink-soft)"
          font-size="11"
        >
          {{ date }}
        </text>
        <g v-for="(line, lineIndex) in allSeries" :key="line.id">
          <polyline
            v-if="line.points.length > 1"
            :points="pointsFor(line)"
            fill="none"
            :stroke="colorFor(line, lineIndex)"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            :stroke-dasharray="line.kind === 'official' ? '6 4' : undefined"
          />
          <circle
            v-for="point in line.points"
            :key="point.id"
            :cx="xFor(point.date)"
            :cy="yFor(point.price)"
            r="4"
            :fill="colorFor(line, lineIndex)"
            stroke="white"
            stroke-width="2"
          >
            <title>{{ line.label }} · {{ point.date }} · {{ money(point.price) }}</title>
          </circle>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.price-chart {
  min-width: 0;
}

.price-chart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  border-bottom: 1px solid var(--line);
  padding: 8px 12px;
}

.price-chart__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-soft);
  font-size: 12px;
}
</style>
