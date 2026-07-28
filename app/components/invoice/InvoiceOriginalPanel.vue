<script setup lang="ts">
import type { Invoice } from '~/stores/invoice'

defineProps<{
  invoice?: Invoice
  previewUrl?: string
}>()
</script>

<template>
  <section class="h-full min-w-0 w-full overflow-y-auto border border-line rounded-[var(--radius-card)] bg-surface-sink p-4 shadow-[var(--shadow-card)]">
    <div class="mb-3 text-12px font-700 text-ink-soft">
      发票原图
    </div>
    <div class="mx-auto border border-line rounded-[var(--radius-card)] bg-panel p-4 shadow-[var(--shadow-card)]" style="aspect-ratio: 1/1.4142; max-width: 560px">
      <object
        v-if="previewUrl"
        :data="previewUrl"
        :aria-label="invoice?.fileName || '上传发票原图'"
        class="h-full w-full rounded-[var(--radius-sm)] object-contain"
      />
      <div v-else-if="invoice" class="h-full flex items-center justify-center">
        <div class="text-center">
          <div class="w-28 h-40 bg-surface-2 rounded-[var(--radius-card)] mx-auto mb-2 flex items-center justify-center border-2 border-brand">
            <span class="text-32px font-800 text-ink-faint">票</span>
          </div>
          <span class="text-11px text-ink-soft block">{{ invoice.fileName || '—' }}</span>
          <span class="text-11px text-ink-faint font-mono">{{ invoice.invoiceNumber?.slice(-8) || '' }}</span>
        </div>
      </div>
      <div v-else class="h-full flex items-center justify-center text-ink-faint text-13px">
        从左侧列表选择发票
      </div>
    </div>
  </section>
</template>
