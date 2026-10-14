<script setup lang="ts">
import type { InvoiceRecognitionFieldMark } from '~/lib/invoice/recognition-changes'
import { INVOICE_RECOGNITION_MARK_LABEL } from '~/lib/invoice/recognition-changes'

// 重新识别草稿的字段角标：图标 + 文字 + 识别前原值（读屏），不只靠颜色；输入框经 aria-describedby 引用本节点。
defineProps<{
  id: string
  mark: InvoiceRecognitionFieldMark
}>()
</script>

<template>
  <span
    :id="id"
    data-testid="invoice-recognition-field-mark"
    class="inline-flex shrink-0 items-center gap-0.5 rounded-[var(--radius-sm)] border border-warn bg-warn-soft px-1.5 py-0.5 text-11px font-600 leading-none text-warn-ink"
    :title="`识别前：${mark.before || '（空）'}`"
  >
    <span :class="mark.mark === 'edited' ? 'i-lucide-pencil' : 'i-lucide-refresh-cw'" class="text-11px" aria-hidden="true" />
    {{ INVOICE_RECOGNITION_MARK_LABEL[mark.mark] }}
    <span class="sr-only">，识别前：{{ mark.before || '（空）' }}</span>
  </span>
</template>
