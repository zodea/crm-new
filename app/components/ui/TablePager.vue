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
  <!-- 汇总条基准（STYLE-GUIDE §3.7 / #110 阶段⑤ E1）：surface-2 底、左统计 + 右分页 -->
  <nav
    aria-label="表格分页"
    class="table-pager flex items-center justify-between gap-1.5 border-t border-line bg-surface-2 px-3 py-2.5 text-13px"
  >
    <span class="text-ink-soft">共 {{ total }} 条</span>
    <div class="table-pager__actions ml-auto min-w-0 flex flex-wrap items-center justify-end gap-1.5">
      <button
        type="button"
        aria-label="上一页"
        class="pager-btn"
        :disabled="page <= 1"
        @click="emit('update:page', page - 1)"
      >
        <span class="i-lucide-chevron-left text-12px" />
      </button>
      <button
        v-for="p in visiblePages"
        :key="p"
        type="button"
        :aria-label="`第 ${p} 页`"
        :aria-current="p === page ? 'page' : undefined"
        data-pager-page
        class="pager-page pager-btn"
        :class="p === page ? 'pager-active' : ''"
        @click="emit('update:page', p)"
      >
        {{ p }}
      </button>
      <button
        type="button"
        aria-label="下一页"
        class="pager-btn"
        :disabled="page >= totalPages"
        @click="emit('update:page', page + 1)"
      >
        <span class="i-lucide-chevron-right text-12px" />
      </button>
      <select
        v-if="pageSizeOptions?.length"
        aria-label="每页条数"
        :value="size"
        class="table-pager__page-size ml-1.5 h-7 border border-line-strong rounded-[var(--radius-sm)] bg-panel px-2 text-13px text-ink-soft cursor-pointer outline-none focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_var(--brand-ring)]"
        @change="emit('update:pageSize', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="n in pageSizeOptions" :key="n" :value="n">
          {{ n }} 条/页
        </option>
      </select>
    </div>
  </nav>
</template>

<style scoped>
.table-pager {
  container-type: inline-size;
  flex-wrap: wrap;
}

@container (max-width: 32rem) {
  .pager-page:not(.pager-active) {
    display: none;
  }

  .table-pager__page-size {
    margin-left: 0;
  }
}
</style>
