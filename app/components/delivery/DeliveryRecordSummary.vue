<script setup lang="ts">
import type { DeliveryPrintDisposition } from '~/stores/delivery-record'
import { computed } from 'vue'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  deliveryDate: string
  lineCount: number
  totalAmount: number
  printDisposition: DeliveryPrintDisposition
}>()

const printLabel = computed(() => ({
  pending: '待打印',
  printed: '已打印',
  excluded: '已排除',
})[props.printDisposition])
const lifecycleDescription = computed(() => {
  if (props.printDisposition === 'pending')
    return '原件与材料明细已归档；到货闭合与库存状态另行确认。当前尚未收到打印成功回执，文件继续保留在待打印范围。'
  if (props.printDisposition === 'printed')
    return '原件与材料明细已归档；到货闭合与库存状态另行确认。该文件已由用户确认实际打印成功。'
  return '原件与材料明细已归档；到货闭合与库存状态另行确认。该文件已明确排除打印范围，但没有记录为已打印。'
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <MetricGrid :cols="5">
      <Metric label="送货日期" :value="deliveryDate || '—'" />
      <Metric label="材料项数" :value="lineCount" />
      <Metric label="金额合计" :value="yuan(totalAmount)" tone="brand" big />
      <Metric label="归档状态" value="已归档" tone="ok" />
      <Metric label="打印状态" :value="printLabel" :tone="printDisposition === 'printed' ? 'ok' : undefined" />
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
