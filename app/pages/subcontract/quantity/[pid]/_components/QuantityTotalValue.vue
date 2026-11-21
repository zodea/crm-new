<script setup lang="ts">
import type { QuantityMeasureTotal } from '~/lib/quantity/totals'
import { computed } from 'vue'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import { formatQuantityTotalCompleteness, formatQuantityValue } from '~/lib/quantity/format'

const props = defineProps<{
  total: QuantityMeasureTotal
  label: string
}>()

const explanation = computed(() => props.total.unitMissing
  ? '尚未标明计量单位，无法计算合计。请先核对各分项的单位。'
  : `${props.total.sourceCount} 项参与合计，${props.total.missingCount} 项缺失。${props.total.knownValue === null ? '暂无已知部分。' : `已知部分为 ${formatQuantityValue(props.total.knownValue)}，不能作为完整合计。`}`)
</script>

<template>
  <span class="inline-flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
    <span class="text-ink font-mono">{{ formatQuantityValue(total.value) }}</span>
    <template v-if="total.completeness === 'partial'">
      <span class="text-11px font-400 text-ink-soft">{{ formatQuantityTotalCompleteness(total) }}</span>
      <ContextHelp :label="label" :text="explanation" />
    </template>
  </span>
</template>
