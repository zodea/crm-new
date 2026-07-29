<script setup lang="ts">
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  deliveryDate: string
  lineCount: number
  totalAmount: number
  archived: boolean
  stored: boolean
}>()

const archivedLabel = computed(() => props.archived ? '已归档' : '尚未归档')
const storedLabel = computed(() => props.stored ? '已入库' : '尚未入库')
const lifecycleDescription = computed(() => {
  if (props.archived && props.stored)
    return '归档表示送货单已进入归档库；材料明细也已写入库存。'
  if (props.archived)
    return '归档仅表示送货单已进入归档库；材料明细尚未写入库存。归档与入库是两个独立动作，当前版本尚未提供入库动作。'
  return '送货单尚未归档，不能从归档库详情进入后续处理。'
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <MetricGrid :cols="5">
      <Metric label="送货日期" :value="deliveryDate || '—'" />
      <Metric label="材料项数" :value="lineCount" />
      <Metric label="金额合计" :value="yuan(totalAmount)" tone="brand" big />
      <Metric label="归档状态" :value="archivedLabel" :tone="archived ? 'ok' : 'danger'" />
      <Metric label="入库状态" :value="storedLabel" :tone="stored ? 'ok' : undefined" />
    </MetricGrid>

    <div
      role="status"
      aria-label="送货单状态说明"
      class="flex min-w-0 items-start gap-2 border border-line rounded-[var(--radius-card)] bg-surface-2 px-3 py-2 text-12px text-ink-soft"
    >
      <span class="i-lucide-info mt-0.5 flex-none text-13px text-brand" aria-hidden="true" />
      <span>{{ lifecycleDescription }}</span>
    </div>
  </div>
</template>
