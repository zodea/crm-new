<script setup lang="ts">
defineProps<{
  total: number
  pendingCount: number
  suggestedCount: number
  recognizing: boolean
  batchPassing: boolean
}>()

const emit = defineEmits<{
  add: []
  recognize: []
  pass: []
}>()
</script>

<template>
  <section class="mb-3.5 flex flex-wrap items-center gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3.5 shadow-[var(--shadow-card)]">
    <div class="mr-1 flex flex-none items-baseline gap-2">
      <h2 class="text-14px font-800 text-ink">
        发票识别
      </h2>
      <span class="text-12px text-ink-soft">
        识别队列 <b class="font-mono text-ink">{{ total }}</b> 张
      </span>
    </div>

    <div class="hidden items-center gap-3 text-11px text-ink-soft xl:flex">
      <span class="inline-flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-ok" />≥95 可信</span>
      <span class="inline-flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-warn" />80–95 待确认</span>
      <span class="inline-flex items-center gap-1"><i class="h-2 w-2 rounded-full bg-danger" />&lt;80 低置信</span>
    </div>

    <div class="ml-auto flex flex-wrap items-center gap-2">
      <NuxtLink to="/finance/ledger" class="btn-secondary inline-flex items-center gap-1">
        <span class="i-lucide-book-open h-3.5 w-3.5" aria-hidden="true" />
        发票台账
      </NuxtLink>
      <button class="btn-secondary" @click="emit('add')">
        <span class="i-lucide-plus mr-1 text-13px" aria-hidden="true" />手动录入
      </button>
      <button
        class="btn-secondary"
        :disabled="recognizing || pendingCount === 0"
        :title="pendingCount === 0 ? '没有待识别的发票' : `识别 ${pendingCount} 张待识别发票`"
        @click="emit('recognize')"
      >
        <span class="mr-1 text-13px" :class="recognizing ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-scan-text'" aria-hidden="true" />
        批量识别{{ pendingCount > 0 ? ` ${pendingCount}` : '' }}
      </button>
      <button
        class="btn-primary"
        :disabled="batchPassing || suggestedCount === 0"
        :title="suggestedCount === 0 ? '没有建议通过的发票' : `放行 ${suggestedCount} 张建议通过发票`"
        @click="emit('pass')"
      >
        <span class="mr-1 text-13px" :class="batchPassing ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-check-check'" aria-hidden="true" />
        批量通过{{ suggestedCount > 0 ? ` ${suggestedCount}` : '' }}
      </button>
    </div>
  </section>
</template>
