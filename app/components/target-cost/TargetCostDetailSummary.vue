<script setup lang="ts">
import type {
  TargetCostDetailHeader,
  TargetCostDetailSummary,
} from '~/lib/target-cost/detail'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  header: TargetCostDetailHeader
  summary: TargetCostDetailSummary
}>()

const rows = computed(() => [
  { label: '科目明细合计', value: yuan(props.summary.itemTotal), tone: 'brand' as const },
  { label: '含税预算基准', value: yuan(props.header.taxInclusiveTotal) },
  { label: '正式已签合同', value: yuan(props.summary.signedAmount) },
  { label: '动态成本', value: yuan(props.summary.settledAmount) },
  { label: '累计支付', value: yuan(props.summary.paidAmount) },
  {
    label: '预算剩余',
    value: yuan(props.summary.remainingAmount),
    tone: props.summary.remainingAmount < 0 ? 'danger' as const : undefined,
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
      :big="row.label === '预算剩余'"
    />
  </MetricGrid>
</template>
