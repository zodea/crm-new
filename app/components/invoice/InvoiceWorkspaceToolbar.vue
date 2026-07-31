<script setup lang="ts">
// 工作台工具栏。子模式切换（字段校对 / 打印排版）内联在这一条里，不再独占一行——
// 版式按设计稿 InvoiceScreen 收拢，语义仍是 reka Tabs（SegTab pill 变体）。
import { CONFIDENCE_THRESHOLDS } from '~/lib/invoice/recognize'

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

const mode = defineModel<string>('mode', { required: true })

const modeTabs = [
  { key: 'review', label: '字段校对', icon: 'i-lucide-list-checks' },
  { key: 'print', label: '打印排版', icon: 'i-lucide-printer' },
]

// 图例文案从阈值常量派生：写死的百分比会跟常量漂移（原先图例写 80，常量已是 85）
const okPct = Math.round(CONFIDENCE_THRESHOLDS.ok * 100)
const warnPct = Math.round(CONFIDENCE_THRESHOLDS.warn * 100)
const legend = [
  { dot: 'bg-ok', text: `≥${okPct} 可信` },
  { dot: 'bg-warn', text: `${warnPct}–${okPct} 待确认` },
  { dot: 'bg-danger', text: `<${warnPct} 低置信` },
]
</script>

<template>
  <section class="panel mb-3 flex flex-wrap items-center gap-3 p-3.5">
    <SegTab v-model="mode" :tabs="modeTabs" variant="pill" class="flex-none" />

    <span class="text-12px text-ink-soft">
      识别队列 <b class="font-mono text-ink">{{ total }}</b> 张
    </span>

    <div class="hidden items-center gap-3 text-11px text-ink-soft xl:flex">
      <span v-for="item in legend" :key="item.text" class="inline-flex items-center gap-1">
        <i class="h-2 w-2 rounded-full" :class="item.dot" />{{ item.text }}
      </span>
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
