<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { TargetCostMetric } from '~/lib/target-cost/central-contract'
import type {
  TargetCostDetailHeader,
  TargetCostDetailSummary,
} from '~/lib/target-cost/detail'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  header: TargetCostDetailHeader
  summary: DeepReadonly<TargetCostDetailSummary>
}>()

function display(metric: DeepReadonly<TargetCostMetric>) {
  return metric.value !== null ? yuan(metric.value) : metric.knownValue !== null ? `已知 ${yuan(metric.knownValue)}` : '未知'
}
const rows = computed(() => [
  { label: '科目明细合计', value: display(props.summary.metrics.targetAmount), metric: props.summary.metrics.targetAmount, tone: 'brand' as const },
  { label: '含税预算基准', value: yuan(props.header.taxInclusiveTotal) },
  { label: '正式已签合同', value: display(props.summary.metrics.signedAmount), metric: props.summary.metrics.signedAmount },
  { label: '动态成本', value: display(props.summary.metrics.settledAmount), metric: props.summary.metrics.settledAmount },
  { label: '累计支付', value: display(props.summary.metrics.paidAmount), metric: props.summary.metrics.paidAmount },
  {
    label: '预算剩余',
    value: display(props.summary.metrics.remainingAmount),
    metric: props.summary.metrics.remainingAmount,
    tone: props.summary.remainingAmount !== null && props.summary.remainingAmount < 0 ? 'danger' as const : undefined,
  },
])
</script>

<template>
  <MetricGrid data-testid="target-cost-summary" :cols="6">
    <Metric
      v-for="row in rows"
      :key="row.label"
      :label="row.label"
      :value="row.value"
      :tone="row.tone"
      :status="row.metric && row.metric.status !== 'complete' ? row.metric.status === 'partial' ? '部分已知' : '来源未齐' : undefined"
      :missing-sources="row.metric?.missingSources.join('；') || undefined"
      :big="row.label === '预算剩余'"
    />
  </MetricGrid>
</template>
