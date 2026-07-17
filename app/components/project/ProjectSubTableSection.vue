<script setup lang="ts" generic="T extends Record<string, any>">
import type { KitTableColumn } from '~/lib/kit/table'
import { clampPage, paginate } from '~/lib/kit/table'

const props = withDefaults(defineProps<{
  title: string
  columns: KitTableColumn[]
  rows: T[]
  loading?: boolean
}>(), {
  loading: false,
})

const page = ref(1)
const pageSize = ref(10)
const pageState = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  total: props.rows.length,
}))
const pagedRows = computed(() => paginate(props.rows, page.value, pageSize.value))

watch(() => props.rows.length, (total) => {
  page.value = clampPage(page.value, total, pageSize.value)
})

function changePage(next: { page: number, pageSize: number }) {
  pageSize.value = next.pageSize
  page.value = clampPage(next.page, props.rows.length, next.pageSize)
}
</script>

<template>
  <section class="space-y-2" :aria-label="title">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-baseline gap-2">
        <h4 class="text-13px text-ink font-700">
          {{ title }}
        </h4>
        <span class="text-11px text-ink-faint">共 {{ rows.length }} 条</span>
      </div>
      <button class="btn-secondary" disabled title="将在对应业务波次开放">
        <span class="i-lucide-plus mr-0.5 text-12px" aria-hidden="true" /> 新建
      </button>
    </div>
    <KitTable
      :columns="columns"
      :data="pagedRows"
      :loading="loading"
      :page="pageState"
      :min-rows="Math.min(5, Math.max(rows.length, 2))"
      @page-change="changePage"
    />
  </section>
</template>
