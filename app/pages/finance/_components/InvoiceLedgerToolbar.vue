<script setup lang="ts">
defineProps<{
  total: number
  visible: number
}>()

const emit = defineEmits<{
  import: []
  export: []
  print: []
}>()

const search = defineModel<string>('search', { required: true })
const view = defineModel<'table' | 'card'>('view', { required: true })
</script>

<template>
  <section class="flex min-w-0 flex-wrap items-center gap-3">
    <div class="mr-1 flex flex-none items-baseline gap-2">
      <h2 class="text-14px font-800 text-ink">
        发票台账
      </h2>
      <span class="text-12px text-ink-soft">
        共 <b class="font-mono text-ink">{{ total }}</b> 张
        <template v-if="visible !== total">· 当前 {{ visible }} 张</template>
      </span>
    </div>

    <div class="ml-auto flex min-w-0 flex-wrap items-center gap-2.5">
      <button type="button" class="btn-secondary" @click="emit('import')">
        <span class="i-lucide-file-input mr-1 text-13px" aria-hidden="true" />
        导入 Excel
      </button>
      <button type="button" class="btn-secondary" @click="emit('print')">
        <span class="i-lucide-printer mr-1 text-13px" aria-hidden="true" />
        打印 PDF
      </button>
      <button type="button" class="btn-primary" @click="emit('export')">
        <span class="i-lucide-file-spreadsheet mr-1 text-13px" aria-hidden="true" />
        导出 Excel
      </button>
      <SearchInput v-model="search" placeholder="搜索编号、供应商、归属…" :width="230" />
      <div class="inline-flex overflow-hidden border border-line-strong rounded-[var(--radius-btn)] bg-panel">
        <button
          v-for="option in (['table', 'card'] as const)"
          :key="option"
          type="button"
          class="inline-flex min-h-8 items-center gap-1 border-0 px-2.5 py-1.5 text-12px transition-colors focus-visible:[outline:2px_solid_var(--brand)] focus-visible:[outline-offset:-2px]"
          :class="view === option ? 'bg-brand-soft font-800 text-brand-deep' : 'bg-panel font-600 text-ink-soft hover:bg-surface-3'"
          :aria-pressed="view === option"
          @click="view = option"
        >
          <span :class="option === 'table' ? 'i-lucide-table' : 'i-lucide-layout-grid'" class="h-[13px] w-[13px]" aria-hidden="true" />
          {{ option === 'table' ? '表格' : '卡片' }}
        </button>
      </div>
    </div>
  </section>
</template>
