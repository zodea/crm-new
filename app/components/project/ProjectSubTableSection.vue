<script setup lang="ts" generic="T extends Record<string, any>">
import type { KitTableColumn } from '~/lib/kit/table'
import { computed, shallowRef, watch } from 'vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'
import { yuan } from '~/lib/util/money'

const props = withDefaults(defineProps<{
  title: string
  columns: KitTableColumn[]
  rows: readonly T[]
  loading?: boolean
  summaryFields?: Array<{ field: string, label: string }>
  empty?: string
}>(), {
  loading: false,
  summaryFields: () => [],
  empty: '暂无数据',
})

const page = shallowRef(1)
const pageSize = shallowRef(10)
const keyword = shallowRef('')
const filters = shallowRef<Record<string, unknown[]>>({})
const searchableFields = computed(() =>
  props.columns
    .filter(column => column.field && !['money', 'action'].includes(column.type ?? 'text'))
    .map(column => column.field!),
)
const filteredRows = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLocaleLowerCase('zh-CN')
  return props.rows.filter((row) => {
    if (normalizedKeyword && !searchableFields.value.some(field =>
      String(row[field] ?? '').toLocaleLowerCase('zh-CN').includes(normalizedKeyword),
    )) {
      return false
    }
    return Object.entries(filters.value).every(([field, values]) =>
      !values.length || values.includes(row[field]),
    )
  })
})
const displayColumns = computed(() => props.columns.map(column =>
  column.field && column.filterable === true
    ? { ...column, filterable: deriveFilterOptions(props.rows, column.field) }
    : column,
))
const pageState = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  total: filteredRows.value.length,
}))
const pagedRows = computed(() => paginate(filteredRows.value, page.value, pageSize.value))
const summaries = computed(() => props.summaryFields.map(summary => ({
  ...summary,
  value: filteredRows.value.reduce((total, row) => total + (Number(row[summary.field]) || 0), 0),
})))

watch(() => filteredRows.value.length, (total) => {
  page.value = clampPage(page.value, total, pageSize.value)
})

function changePage(next: { page: number, pageSize: number }) {
  pageSize.value = next.pageSize
  page.value = clampPage(next.page, filteredRows.value.length, next.pageSize)
}

function changeFilters(payload: {
  filters: Array<{ field: string, values: unknown[] }>
}) {
  filters.value = Object.fromEntries(payload.filters.map(filter => [filter.field, filter.values]))
  page.value = 1
}
</script>

<template>
  <section class="space-y-2" :aria-label="title">
    <div class="flex flex-wrap items-center gap-2">
      <div class="mr-auto flex items-baseline gap-2">
        <h4 class="text-13px text-ink font-700">
          {{ title }}（{{ filteredRows.length }}）
        </h4>
        <span v-if="filteredRows.length !== rows.length" class="text-11px text-ink-faint">
          原 {{ rows.length }} 条
        </span>
      </div>
      <label class="relative min-w-44 flex-1 sm:max-w-64">
        <span class="sr-only">搜索{{ title }}</span>
        <span class="i-lucide-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-13px text-ink-faint" aria-hidden="true" />
        <input
          v-model="keyword"
          type="search"
          class="field-input h-8 w-full pl-8 text-12px"
          :placeholder="`搜索${title}`"
          @input="page = 1"
        >
      </label>
      <slot name="actions" />
    </div>
    <KitTable
      :columns="displayColumns"
      :data="pagedRows"
      :loading="loading"
      :page="pageState"
      :min-rows="Math.min(5, Math.max(rows.length, 2))"
      :empty="empty"
      remote-filter
      @page-change="changePage"
      @filter-change="changeFilters"
    >
      <template #link="{ row, rowIndex }">
        <slot name="link" :row="row" :row-index="rowIndex" />
      </template>
      <template #status="{ row, rowIndex }">
        <slot name="status" :row="row" :row-index="rowIndex">
          <KitStatusTag>{{ row.status || '—' }}</KitStatusTag>
        </slot>
      </template>
      <template #source="{ row, rowIndex }">
        <slot name="source" :row="row" :row-index="rowIndex" />
      </template>
    </KitTable>
    <div
      v-if="summaries.length"
      class="flex flex-wrap justify-end gap-x-5 gap-y-1 rounded-[var(--radius-control)] border border-line bg-surface-2 px-3 py-2 text-11px"
      aria-label="筛选结果合计"
    >
      <span v-for="summary in summaries" :key="summary.field" class="text-ink-soft">
        {{ summary.label }}
        <strong class="ml-1 font-mono text-ink">{{ yuan(summary.value) }}</strong>
      </span>
    </div>
  </section>
</template>
