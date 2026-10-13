<script setup lang="ts">
import type { InvoiceRecognitionChange } from '~/lib/invoice/recognition-changes'

// 重新识别草稿提醒：识别结果只在当前表单中，保存（二次确认）前不写库；放弃则恢复识别前的值。
defineProps<{
  changes: readonly InvoiceRecognitionChange[]
  /** 提供时在提醒内显示保存按钮（工作台没有独立保存按钮）；整页编辑沿用页面的保存。 */
  saveLabel?: string
}>()

const emit = defineEmits<{
  discard: []
  save: []
}>()
</script>

<template>
  <div
    data-testid="invoice-recognition-changes"
    role="status"
    class="border border-warn/35 rounded-[var(--radius-btn)] bg-warn-soft p-3 text-12px text-warn-ink"
  >
    <p class="flex items-start gap-1.5 font-700">
      <span class="i-lucide-refresh-cw mt-0.5 shrink-0 text-12px" aria-hidden="true" />
      <span v-if="changes.length">重新识别结果未保存：{{ changes.length }} 项与识别前不同，已在字段上标出，请逐项核对后保存</span>
      <span v-else>重新识别结果未保存：票面字段与识别前一致，保存后回到待校对</span>
    </p>
    <ul v-if="changes.length" class="mt-1.5 space-y-1">
      <li v-for="change in changes" :key="change.key" class="break-all">
        <span class="font-600">{{ change.label }}</span>：<span class="line-through opacity-75">{{ change.before || '（空）' }}</span>
        → <span class="font-600">{{ change.after || '（空）' }}</span>
      </li>
    </ul>
    <div class="mt-2 flex flex-wrap justify-end gap-2">
      <button type="button" class="btn-ghost h-7 px-2 text-12px" @click="emit('discard')">
        放弃识别结果
      </button>
      <button v-if="saveLabel" type="button" class="btn-accent h-7 px-2 text-12px" @click="emit('save')">
        {{ saveLabel }}
      </button>
    </div>
  </div>
</template>
