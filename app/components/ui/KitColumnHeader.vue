<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, shallowRef, watch } from 'vue'
import { useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'

export type ColumnFilterValue = string | { min?: number, max?: number }

const props = defineProps<{
  title: string
  kind: 'text' | 'enum' | 'number'
  value?: ColumnFilterValue
  options?: { key: string, label: string }[]
  sort?: string
  sortOptions?: { key: string, label: string }[]
}>()
const emit = defineEmits<{ apply: [value: ColumnFilterValue], sort: [key: string] }>()
const open = shallowRef(false)
const text = shallowRef('')
const min = shallowRef('')
const max = shallowRef('')
const problem = shallowRef('')
const ownedLayerStyle = useOwnedOverlayLayerStyle()
const active = computed(() => typeof props.value === 'string'
  ? Boolean(props.value)
  : props.value?.min !== undefined || props.value?.max !== undefined)
const sorted = computed(() => props.sortOptions?.some(option => option.key === props.sort))

watch(open, (value) => {
  if (!value)
    return
  text.value = typeof props.value === 'string' ? props.value : ''
  min.value = typeof props.value === 'object' && props.value.min !== undefined ? String(props.value.min) : ''
  max.value = typeof props.value === 'object' && props.value.max !== undefined ? String(props.value.max) : ''
  problem.value = ''
})

function apply() {
  if (props.kind === 'number') {
    const range = {
      ...(min.value !== '' ? { min: Number(min.value) } : {}),
      ...(max.value !== '' ? { max: Number(max.value) } : {}),
    }
    if (Object.values(range).some(value => !Number.isFinite(value))) {
      problem.value = '请输入有效数值'
      return
    }
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      problem.value = '最大值不能小于最小值'
      return
    }
    emit('apply', range)
  }
  else {
    emit('apply', text.value.trim())
  }
  open.value = false
}

function clear() {
  emit('apply', props.kind === 'number' ? {} : '')
  open.value = false
}

function sortBy(key: string) {
  emit('sort', key)
  open.value = false
}
</script>

<template>
  <div role="columnheader" :aria-sort="sortOptions?.length ? (sorted ? (sort?.endsWith('-desc') ? 'descending' : 'ascending') : 'none') : undefined">
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button type="button" class="kit-column-header" :class="{ 'is-active': active || sorted }" :aria-label="`筛选${title}`" :title="`${title}：筛选${sortOptions?.length ? ' / 排序' : ''}`">
          <span class="truncate">{{ title }}</span>
          <span v-if="sortOptions?.length" :class="sorted ? (sort?.endsWith('-desc') ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up') : 'i-lucide-arrow-up-down'" class="h-3 w-3 shrink-0" aria-hidden="true" />
          <span class="i-lucide-filter ml-auto h-3 w-3 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent :aria-label="`筛选${title}`" align="start" :side-offset="5" :collision-padding="12" data-overlay-owned :style="ownedLayerStyle" class="overlay-layer-owned w-[min(260px,calc(100vw-24px))] border border-line rounded-sm bg-panel p-3 text-12px text-ink shadow-[var(--shadow-pop)] outline-none">
          <form class="grid gap-2" @submit.prevent="apply">
            <strong class="font-600">{{ title }}</strong>
            <template v-if="sortOptions?.length">
              <div class="flex gap-1 border-b border-line pb-2">
                <button v-for="option in sortOptions" :key="option.key" type="button" class="btn-ghost flex-1 px-2 text-12px" :aria-pressed="sort === option.key" @click="sortBy(option.key)">
                  {{ option.label }}
                </button>
              </div>
            </template>
            <input v-if="kind === 'text'" v-model="text" class="kit-filter-input" :aria-label="`${title}包含`" placeholder="包含关键词" maxlength="120">
            <select v-else-if="kind === 'enum'" v-model="text" class="kit-filter-input" :aria-label="`${title}筛选值`">
              <option value="">
                全部
              </option>
              <option v-for="option in options" :key="option.key" :value="option.key">
                {{ option.label }}
              </option>
            </select>
            <div v-else class="flex items-center gap-2">
              <input v-model="min" class="kit-filter-input min-w-0 w-1/2" type="number" step="any" aria-label="最小值" placeholder="最小值">
              <span>至</span>
              <input v-model="max" class="kit-filter-input min-w-0 w-1/2" type="number" step="any" aria-label="最大值" placeholder="最大值">
            </div>
            <p v-if="problem" role="alert" class="text-danger">
              {{ problem }}
            </p>
            <div class="mt-1 flex justify-end gap-2">
              <button type="button" class="btn-secondary px-3 text-12px" @click="clear">
                清除
              </button>
              <button type="submit" class="btn-primary px-3 text-12px">
                应用
              </button>
            </div>
          </form>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>

<style scoped>
.kit-column-header { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 28px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.kit-column-header:hover, .kit-column-header.is-active { color: var(--brand); }
.kit-column-header:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.kit-filter-input { height: 30px; padding: 4px 7px; border: 1px solid var(--line-strong); border-radius: 2px; background: var(--panel); color: var(--ink); outline: none; }
.kit-filter-input:focus-visible { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-ring); }
</style>
