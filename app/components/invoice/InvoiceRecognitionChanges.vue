<script setup lang="ts">
import type { InvoiceRecognitionChange } from '~/lib/invoice/recognition-changes'

defineProps<{
  changes: readonly InvoiceRecognitionChange[]
}>()

const emit = defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <div
    data-testid="invoice-recognition-changes"
    role="status"
    class="border border-warn/35 rounded-[var(--radius-btn)] bg-warn-soft p-3 text-12px text-warn-ink"
  >
    <div class="flex items-start justify-between gap-2">
      <p class="font-700">
        重新识别覆盖了 {{ changes.length }} 项与识别前不同的内容，请逐项核对：
      </p>
      <button type="button" class="btn-ghost h-6 shrink-0 px-2 text-11px" aria-label="关闭识别变动提醒" @click="emit('dismiss')">
        知道了
      </button>
    </div>
    <ul class="mt-1.5 space-y-1">
      <li v-for="change in changes" :key="change.key" class="break-all">
        <span class="font-600">{{ change.label }}</span>：<span class="line-through opacity-75">{{ change.before || '（空）' }}</span>
        → <span class="font-600">{{ change.after || '（空）' }}</span>
      </li>
    </ul>
  </div>
</template>
