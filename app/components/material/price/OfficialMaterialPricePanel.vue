<script setup lang="ts">
import type {
  OfficialMarketDeviation,
  OfficialMaterialCategory,
  OfficialMaterialPriceSeries,
} from '~/lib/material/official-price-source'
import { computed } from 'vue'
import {
  calculateLatestOfficialPriceChange,
  GUANGZHOU_OFFICIAL_PRICE_SOURCE,
} from '~/lib/material/official-price-source'

const props = defineProps<{
  category: OfficialMaterialCategory
  series: OfficialMaterialPriceSeries | null
  deviation: OfficialMarketDeviation | null
}>()

const latestPoint = computed(() => props.series?.points.at(-1) ?? null)
const monthlyChange = computed(() => calculateLatestOfficialPriceChange(props.series))

function money(value: number, digits = 2): string {
  return `¥${value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function signedMoney(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${money(Math.abs(value), 5)}`
}

function signedPercent(value: number): string {
  const percent = value * 100
  const sign = percent > 0 ? '+' : ''
  return `${sign}${percent.toFixed(2)}%`
}
</script>

<template>
  <section
    class="official-price"
    aria-label="官方信息价对比"
  >
    <div class="official-price__header">
      <div class="min-w-0">
        <p class="text-12px font-800 text-ink">
          广州官方信息价
        </p>
        <p class="mt-0.5 truncate text-11px text-ink-soft">
          {{ category.order === 99 ? category.name : `第 ${category.order} 类 · ${category.name}` }}
        </p>
      </div>
      <a
        :href="GUANGZHOU_OFFICIAL_PRICE_SOURCE.url"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="查看广州官方价格信息"
        class="btn-ghost shrink-0 text-12px"
      >
        官方月刊
      </a>
    </div>

    <template v-if="series && latestPoint">
      <div class="official-price__facts">
        <div class="info-cell">
          <span class="text-11px text-ink-soft">材料编码</span>
          <strong class="mt-1 block truncate font-mono text-12px text-ink">
            {{ series.identity.materialCode }}
          </strong>
        </div>
        <div class="info-cell">
          <span class="text-11px text-ink-soft">最新信息价</span>
          <strong class="mt-1 block font-mono text-14px text-brand-deep">
            {{ money(latestPoint.sourcePrice) }}/{{ latestPoint.sourceUnit }}
          </strong>
          <span class="mt-0.5 block text-10px text-ink-faint">
            已换算 {{ money(latestPoint.price, 5) }}/{{ latestPoint.normalizedUnit }}
          </span>
        </div>
        <div class="info-cell">
          <span class="text-11px text-ink-soft">市场中位价偏差</span>
          <strong
            v-if="deviation"
            class="mt-1 block font-mono text-14px"
            :class="deviation.rate > 0 ? 'text-warn' : deviation.rate < 0 ? 'text-ok' : 'text-ink'"
          >
            {{ signedPercent(deviation.rate) }}
          </strong>
          <span v-else class="mt-1 block text-12px text-ink-faint">无可比市场价</span>
          <span v-if="deviation" class="mt-0.5 block text-10px text-ink-faint">
            {{ signedMoney(deviation.amount) }}/{{ series.identity.normalizedUnit }}
          </span>
        </div>
        <div class="info-cell">
          <span class="text-11px text-ink-soft">信息价环比</span>
          <strong
            v-if="monthlyChange"
            class="mt-1 block font-mono text-14px"
            :class="monthlyChange.rate > 0 ? 'text-warn' : monthlyChange.rate < 0 ? 'text-ok' : 'text-ink'"
          >
            {{ signedPercent(monthlyChange.rate) }}
          </strong>
          <span v-else class="mt-1 block text-12px text-ink-faint">至少需要两期</span>
          <span v-if="monthlyChange" class="mt-0.5 block text-10px text-ink-faint">
            {{ signedMoney(monthlyChange.amount) }}/{{ series.identity.normalizedUnit }} · 较 {{ monthlyChange.previousMonth }}
          </span>
        </div>
        <div class="info-cell">
          <span class="text-11px text-ink-soft">最新发布期</span>
          <strong class="mt-1 block font-mono text-14px text-ink">{{ latestPoint.month }}</strong>
          <a
            :href="latestPoint.sourceUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-0.5 inline-block text-10px text-brand hover:underline"
          >
            查看官方原文
          </a>
        </div>
      </div>
      <p class="official-price__basis">
        {{ GUANGZHOU_OFFICIAL_PRICE_SOURCE.priceBasis }}。{{ GUANGZHOU_OFFICIAL_PRICE_SOURCE.disclaimer }}
      </p>
    </template>

    <div v-else role="status" class="official-price__empty">
      <span class="i-lucide-circle-off shrink-0 text-18px text-ink-faint" />
      <p>
        当前材料暂无对应官方记录。系统只关联已核实的“材料编码 + 规格 + 单位”，不会用同大类均价代替。
      </p>
    </div>
  </section>
</template>

<style scoped>
.official-price {
  border-top: 1px solid var(--line);
  background: var(--surface-2);
}

.official-price__header {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding: 7px 12px;
}

.official-price__facts {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
}

.official-price__basis {
  border-top: 1px solid var(--line);
  padding: 7px 12px;
  color: var(--ink-soft);
  font-size: 10px;
  line-height: 1.5;
}

.official-price__empty {
  display: flex;
  min-height: 60px;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  color: var(--ink-soft);
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 800px) {
  .official-price__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .official-price__facts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
