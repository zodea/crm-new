<script setup lang="ts">
export interface ListFilterOption {
  value: string
  label: string
}

export interface ListFilterDefinition {
  key: string
  label: string
  value: string
  options: readonly ListFilterOption[]
}

const props = withDefaults(defineProps<{
  filters?: readonly ListFilterDefinition[]
  total: number
  filtered: number
  pageCount: number
}>(), {
  filters: () => [],
})

const emit = defineEmits<{
  filterChange: [key: string, value: string]
}>()

const query = defineModel<string>('query', { required: true })
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

function updateFilter(key: string, event: Event) {
  emit('filterChange', key, (event.currentTarget as HTMLSelectElement).value)
}
</script>

<template>
  <section class="panel flex flex-wrap items-center gap-2.5 px-3.5 py-2.5" aria-label="列表筛选与分页">
    <SearchInput v-model="query" placeholder="搜索…" :width="240" />

    <label v-for="filter in props.filters" :key="filter.key" class="inline-flex items-center gap-1.5 text-12px text-ink-soft">
      <span>{{ filter.label }}</span>
      <select
        :value="filter.value"
        class="field-input h-8 min-w-28 py-1 text-12px"
        :aria-label="filter.label"
        @change="updateFilter(filter.key, $event)"
      >
        <option value="">全部</option>
        <option v-for="option in filter.options" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </label>

    <span class="ml-auto text-11px text-ink-faint">
      筛选后 <b class="font-mono text-ink">{{ filtered }}</b> 条<span v-if="filtered !== total"> · 共 {{ total }} 条</span>
    </span>

    <div class="inline-flex items-center gap-1.5 text-11px text-ink-soft">
      <button type="button" class="pager-btn" :disabled="page <= 1" aria-label="上一页" @click="page--">
        <span class="i-lucide-chevron-left" aria-hidden="true" />
      </button>
      <span class="min-w-12 text-center font-mono tabular-nums">{{ page }} / {{ pageCount }}</span>
      <button type="button" class="pager-btn" :disabled="page >= pageCount" aria-label="下一页" @click="page++">
        <span class="i-lucide-chevron-right" aria-hidden="true" />
      </button>
      <select v-model.number="pageSize" class="field-input h-8 w-18 py-1 text-11px" aria-label="每页条数">
        <option :value="10">
          10 条/页
        </option>
        <option :value="20">
          20 条/页
        </option>
        <option :value="50">
          50 条/页
        </option>
      </select>
    </div>
  </section>
</template>
