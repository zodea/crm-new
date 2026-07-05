<script setup lang="ts">
// 独立指标卡（首页/台账顶部四卡）。密排网格用 <Metric>/<MetricGrid>；二者
// 共享 formatMoney 保证金额口径一致（¥#,##0.00 完整展示，两位小数）。
import { formatMoney } from '~/lib/util/money'

defineProps<{
  label: string
  value: string | number
  icon?: string
  color?: 'brand' | 'ok' | 'danger' | 'warn'
  suffix?: string
}>()

const colorClass: Record<string, string> = {
  brand: 'text-brand',
  ok: 'text-ok',
  danger: 'text-danger',
  warn: 'text-warn',
}
</script>

<template>
  <div class="border border-line bg-panel px-4 py-3">
    <div class="flex items-center gap-2 mb-1.5">
      <span v-if="icon" :class="icon" class="text-16px text-ink-faint" aria-hidden="true" />
      <span class="text-11px font-600 text-ink-faint">{{ label }}</span>
    </div>
    <div class="font-mono text-20px font-500 tabular-nums" :class="color ? colorClass[color] : 'text-ink'">
      {{ typeof value === 'number' ? formatMoney(value) : value }}
      <span v-if="suffix" class="text-12px font-400 text-ink-faint ml-0.5">{{ suffix }}</span>
    </div>
  </div>
</template>
