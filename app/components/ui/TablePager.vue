<script setup lang="ts">
import { pageCount } from '~/lib/kit/table'

const props = defineProps<{
  total: number
  page: number
  pageSize?: number
  /** 传入即显示「N 条/页」切换下拉(设计稿 KitTable 三件套的条数切换)。 */
  pageSizeOptions?: number[]
}>()

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
}>()

const size = computed(() => props.pageSize ?? 20)
const totalPages = computed(() => pageCount(props.total, size.value))

const visiblePages = computed(() => {
  const pages: number[] = []
  const total = totalPages.value
  // 页码窗口以钳制后的当前页为锚:props.page 越界(如筛选收窄后)时窗口不塌空
  const cur = Math.min(Math.max(1, props.page), total)
  const start = Math.max(1, cur - 2)
  const end = Math.min(total, start + 4)
  for (let i = start; i <= end; i++) pages.push(i)
  return pages
})
</script>

<template>
  <div class="flex items-center justify-end gap-1.5 border-t border-line px-2 py-2 text-13px">
    <span class="text-ink-faint mr-2">共 {{ total }} 条</span>
    <button
      class="pager-btn"
      :disabled="page <= 1"
      @click="emit('update:page', page - 1)"
    >
      <span class="i-lucide-chevron-left text-12px" />
    </button>
    <button
      v-for="p in visiblePages"
      :key="p"
      class="pager-btn"
      :class="p === page ? 'pager-active' : ''"
      @click="emit('update:page', p)"
    >
      {{ p }}
    </button>
    <button
      class="pager-btn"
      :disabled="page >= totalPages"
      @click="emit('update:page', page + 1)"
    >
      <span class="i-lucide-chevron-right text-12px" />
    </button>
    <select
      v-if="pageSizeOptions?.length"
      :value="size"
      class="ml-1.5 h-7 border border-line-strong rounded-[var(--radius-sm)] bg-panel px-2 text-13px text-ink-soft cursor-pointer outline-none focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_var(--brand-ring)]"
      @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="n in pageSizeOptions" :key="n" :value="n">
        {{ n }} 条/页
      </option>
    </select>
  </div>
</template>
