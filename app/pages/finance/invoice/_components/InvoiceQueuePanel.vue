<script setup lang="ts">
import type { Invoice } from '~/stores/invoice'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'

interface QueueRow {
  inv: Invoice
  label: string
  cls: string
  dotCls: string
}

defineProps<{
  rows: readonly QueueRow[]
  total: number
  pendingReview: number
}>()

const emit = defineEmits<{
  upload: []
}>()

const search = defineModel<string>('search', { required: true })
const filter = defineModel<string[]>('filter', { required: true })
const selectedId = defineModel<string | null>('selectedId', { required: true })
const filterOptions = [
  { key: 'recognizing', label: '识别中' },
  { key: 'suggested', label: '建议通过' },
  { key: 'warning', label: '待确认' },
  { key: 'danger', label: '含低置信' },
]
</script>

<template>
  <aside class="panel h-full min-w-0 w-full overflow-hidden flex flex-col">
    <div class="flex flex-col gap-2 border-b border-line bg-surface-2 p-2.5">
      <button class="btn-primary w-full" @click="emit('upload')">
        <span class="i-lucide-upload mr-1 text-12px" aria-hidden="true" />上传发票
      </button>
      <KitMultiSelectFilter v-model="filter" label="状态" aria-label="筛选识别队列" :options="filterOptions" full-width :min-width="100" />
      <input v-model="search" type="search" class="field-input w-full text-12px" placeholder="搜索票号、文件、公司…">
    </div>
    <div class="px-2.5 py-1.5 border-b border-line text-11px text-ink-soft">
      当前 {{ rows.length }} 张 · 待校对 {{ pendingReview }}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <button
        v-for="{ inv, label, cls, dotCls } in rows"
        :key="inv.id"
        type="button"
        :aria-label="`选择发票 ${inv.invoiceNumber || inv.fileName}`"
        class="flex w-full items-center gap-2 border-0 border-b border-line px-2.5 py-2.5 text-left transition-colors focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]"
        :class="selectedId === inv.id ? 'bg-brand-soft' : 'bg-panel hover:bg-surface-3'"
        @click="selectedId = inv.id"
      >
        <span class="h-2 w-2 shrink-0 rounded-full" :class="dotCls" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-11px font-700" :title="inv.fileName || inv.invoiceNumber">
            {{ inv.invoiceNumber ? `…${inv.invoiceNumber.slice(-8)}` : (inv.fileName || '—') }}
          </span>
          <span class="mt-0.5 block truncate text-10px text-ink-soft">{{ inv.seller || inv.buyer || inv.fileName || '待识别' }}</span>
        </span>
        <span class="shrink-0 text-10px" :class="cls">{{ label }}</span>
      </button>
      <div v-if="!rows.length" class="p-4 text-center text-ink-faint text-12px">
        {{ total ? '当前筛选下暂无发票' : '上传发票开始识别' }}
      </div>
    </div>
  </aside>
</template>
