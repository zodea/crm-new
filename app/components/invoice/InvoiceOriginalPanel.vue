<script setup lang="ts">
import type { InvoiceRecognitionField } from '~/lib/invoice/recognition-changes'
import type { InvoiceRegionHighlightGroup } from '~/lib/invoice/recognition-regions'
import type { Invoice } from '~/stores/invoice'

defineProps<{
  invoice?: Invoice
  /** 上传会话中的原文件；不在会话中时如实说明，不显示示意图 */
  file?: File
  /** 区域叠加：compare = 重新识别草稿的变动比对；focus = 首次识别点字段定位 */
  regions?: {
    mode: 'compare' | 'focus'
    groups: readonly InvoiceRegionHighlightGroup[]
    unlocated: readonly InvoiceRecognitionField[]
    activeKey: string | null
  }
}>()
</script>

<template>
  <section
    class="h-full min-w-0 w-full border border-line rounded-[var(--radius-card)] bg-surface-sink p-4 shadow-[var(--shadow-card)]"
    :class="invoice && file ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'"
  >
    <div class="mb-3 text-12px font-700 text-ink-soft">
      发票原图
    </div>
    <InvoiceRegionViewer
      v-if="invoice && file"
      class="min-h-0 flex-1"
      :file="file"
      :mode="regions?.mode"
      :groups="regions?.groups"
      :unlocated="regions?.unlocated"
      :active-key="regions?.activeKey"
    />
    <div v-else class="mx-auto border border-line rounded-[var(--radius-card)] bg-panel shadow-[var(--shadow-card)]" style="max-width: 560px">
      <InvoiceOriginalMissing v-if="invoice" :invoice="invoice" />
      <div v-else class="py-10 text-center text-13px text-ink-faint">
        从左侧列表选择发票
      </div>
    </div>
  </section>
</template>
