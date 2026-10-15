<script setup lang="ts">
import type { InvoiceRecognitionFieldMark } from '~/lib/invoice/recognition-changes'
import { INVOICE_RECOGNITION_MARK_LABEL } from '~/lib/invoice/recognition-changes'

// 重新识别草稿的字段角标：图标 + 文字 + 识别前原值（读屏），不只靠颜色；输入框经 aria-describedby 引用本节点。
defineProps<{
  id: string
  mark: InvoiceRecognitionFieldMark
  /** 原图比对可用时：该字段是否在原图上框出（undefined = 不在比对中，不播报） */
  located?: boolean
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
    <span class="sr-only">，识别前：{{ mark.before || '（空）' }}<template v-if="located !== undefined">{{ located ? '，原图已框出' : '，原图未定位' }}</template></span>
  </span>
</template>
