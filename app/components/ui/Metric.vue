<script setup lang="ts">
// 指标格（KitAtoms）：label + ⓘ公式提示 + 大数字。密排于 MetricGrid 内。
// 基准：DC重构设计源码/kit/KitAtoms.jsx Metric。
// 金额：设计源码约定「两位小数由调用方保证」；本组件额外提供 money 便捷开关，
// value 为数字时按 ¥#,##0.00 完整展示（#50 AC②）。
import type { RouteLocationRaw } from 'vue-router'
import StatCard from './StatCard.vue'

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
  /** 金额穿透目标（specs §07）：给定即渲染 MoneyLink，0/空自动退化。 */
  to?: RouteLocationRaw | null
  /** OperatingMetric 完整性：有值时在卡片内显示，避免只给整组一个笼统状态。 */
  status?: string
  cutoff?: string
  missingSources?: string
}>(), { money: false, to: null })
</script>

<template>
  <StatCard
    variant="grid" currency :label="props.label" :value="props.value" :formula="props.formula"
    :color="props.tone" :big="props.big" :money="props.money" :to="props.to"
    :status="props.status" :cutoff="props.cutoff" :missing-sources="props.missingSources"
  />
</template>
