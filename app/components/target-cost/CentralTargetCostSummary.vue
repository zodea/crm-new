<script setup lang="ts">
import type { TargetCostDetailRead } from '~/lib/target-cost/central-contract'
import TargetCostMetricValue from '~/components/target-cost/TargetCostMetricValue.vue'
import { yuan } from '~/lib/util/money'

defineProps<{ view: TargetCostDetailRead['view'] }>()
const metrics = [{ key: 'signedAmount', label: '正式已签合同' }, { key: 'settledAmount', label: '动态成本' }, { key: 'paidAmount', label: '累计支付' }, { key: 'remainingAmount', label: '预算剩余' }] as const
</script>

<template>
  <section class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3" aria-label="预算与实际成本摘要">
    <div class="panel p-3">
      <p class="mb-2 text-11px text-ink-faint">
        科目明细合计
      </p><strong class="font-mono text-brand">{{ yuan(view.summary.itemTotal) }}</strong>
    </div>
    <div class="panel p-3">
      <p class="mb-2 text-11px text-ink-faint">
        含税预算基准
      </p><strong class="font-mono">{{ yuan(view.header.taxInclusiveTotal) }}</strong>
    </div>
    <div v-for="metric in metrics" :key="metric.key" class="panel p-3">
      <p class="mb-2 text-11px text-ink-faint">
        {{ metric.label }}
      </p><TargetCostMetricValue :metric="view.summary[metric.key]" />
    </div>
  </section>
</template>
