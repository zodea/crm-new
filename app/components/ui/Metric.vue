<script setup lang="ts">
// 指标格（KitAtoms）：label + ⓘ公式提示 + 大数字。密排于 MetricGrid 内。
// 基准：DC重构设计源码/kit/KitAtoms.jsx Metric。
// 金额：设计源码约定「两位小数由调用方保证」；本组件额外提供 money 便捷开关，
// value 为数字时按 ¥#,##0.00 完整展示（#50 AC②）。
import { computed } from 'vue'
import { formatMoney } from '~/lib/util/money'

const props = withDefaults(defineProps<{
  label: string
  value: string | number
  /** 悬停说明的口径公式（显示 ⓘ 图标）。 */
  formula?: string
  tone?: 'ok' | 'danger' | 'brand'
  /** 大号数字（关键指标，如可用资金余额）。 */
  big?: boolean
  /** value 为数字金额时，按 ¥#,##0.00 完整展示。 */
  money?: boolean
}>(), { money: false })

const display = computed(() =>
  props.money && typeof props.value === 'number'
    ? formatMoney(props.value, { currency: true })
    : props.value,
)

const toneClass = computed(() => {
  switch (props.tone) {
    case 'ok': return 'text-ok-ink'
    case 'danger': return 'text-danger-ink'
    case 'brand': return 'text-brand'
    default: return 'text-ink'
  }
})
</script>

<template>
  <div class="min-w-0 bg-panel px-[14px] py-[12px]">
    <div class="flex items-center gap-[4px] text-[11px] font-600 text-ink-faint">
      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ label }}</span>
      <span v-if="formula" :title="formula" class="inline-flex cursor-help">
        <span class="i-lucide-info h-[11px] w-[11px] text-ink-faint" />
      </span>
    </div>
    <div
      class="mt-[5px] whitespace-nowrap font-mono tracking-[-0.015em] leading-[1.25]"
      :class="[toneClass, big ? 'text-[17.5px] font-800' : 'text-[13.5px] font-700']"
      :title="typeof value === 'string' ? value : undefined"
    >
      {{ display }}
    </div>
  </div>
</template>
