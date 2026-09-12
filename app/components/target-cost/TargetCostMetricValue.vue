<script setup lang="ts">
import type { TargetCostMetric } from '~/lib/target-cost/central-contract'
import { yuan } from '~/lib/util/money'

defineProps<{ metric: TargetCostMetric }>()
function sourceDescription(value: string): string {
  const labels: Record<string, string> = { forbidden: '当前身份无权读取', pending: '资料或关系待完善', unavailable: '来源暂不可用' }
  const match = /^(.*):(forbidden|pending|unavailable)$/.exec(value)
  return match ? `${match[1]}：${labels[match[2]!]}` : value
}
</script>

<template>
  <div class="min-w-0 text-12px">
    <strong class="font-mono tabular-nums" :class="metric.value != null && metric.value < 0 ? 'text-danger' : 'text-ink'">{{ metric.status === 'not-applicable' ? '不适用' : metric.value != null ? yuan(metric.value) : metric.knownValue != null ? `已知 ${yuan(metric.knownValue)}` : '未知' }}</strong>
    <span v-if="metric.status !== 'complete' && metric.status !== 'not-applicable'" class="ml-1 text-11px font-400 text-warn-ink">{{ metric.status === 'partial' ? '部分已知' : '来源未齐' }}</span>
    <details v-if="metric.missingSources.length" class="mt-1 text-11px font-400 text-ink-soft">
      <summary class="cursor-pointer">
        查看来源缺口
      </summary>
      <ul class="mt-1 list-disc space-y-1 pl-4">
        <li v-for="source in metric.missingSources" :key="source" class="break-words">
          {{ sourceDescription(source) }}
        </li>
      </ul>
    </details>
  </div>
</template>
