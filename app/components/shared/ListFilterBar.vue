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
}>(), {
  filters: () => [],
})

const emit = defineEmits<{
  filterChange: [key: string, value: string]
}>()

const query = defineModel<string>('query', { required: true })

function updateFilter(key: string, event: Event) {
  emit('filterChange', key, (event.currentTarget as HTMLSelectElement).value)
}
</script>

<template>
  <section class="panel flex flex-wrap items-center gap-2.5 px-3.5 py-2.5" aria-label="列表筛选">
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
  </section>
</template>
