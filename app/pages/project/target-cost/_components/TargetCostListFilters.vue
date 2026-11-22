<script setup lang="ts">
import ContextHelp from '~/components/ui/ContextHelp.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'

interface FilterOption {
  key: string
  label: string
}

withDefaults(defineProps<{
  loading: boolean
  projectOptions: readonly FilterOption[]
  statusOptions: readonly FilterOption[]
  canCreate?: boolean
}>(), { canCreate: true })

const emit = defineEmits<{
  refresh: []
  create: []
}>()

const search = defineModel<string>('search', { required: true })
const project = defineModel<string>('project', { required: true })
const baseline = defineModel<string[]>('baseline', { required: true })
const status = defineModel<string[]>('status', { required: true })
</script>

<template>
  <div class="min-w-0 flex flex-1 flex-col gap-3">
    <div class="flex min-w-0 flex-wrap items-center gap-3">
      <div class="mr-auto min-w-0 flex items-center gap-1">
        <h1 class="text-17px font-800 text-ink">
          目标成本列表
        </h1>
        <ContextHelp label="目标成本基线" text="当前基线用于项目成本动态对比；可按基线范围筛选预算版本。" />
      </div>
      <KitButton type="button" variant="secondary" :loading="loading" @click="emit('refresh')">
        <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />
        刷新
      </KitButton>
      <KitButton type="button" variant="primary" :disabled="!canCreate" @click="emit('create')">
        <span class="i-lucide-plus mr-1" aria-hidden="true" />
        新建目标成本
      </KitButton>
    </div>

    <div
      class="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_repeat(3,minmax(9rem,12rem))]"
      role="search"
      aria-label="目标成本筛选"
    >
      <SearchInput v-model="search" placeholder="搜索版本名或项目" />
      <label class="sr-only" for="target-cost-project-filter">项目</label>
      <select
        id="target-cost-project-filter"
        v-model="project"
        class="field-input h-8 min-w-0 text-12px"
      >
        <option v-for="option in projectOptions" :key="option.key" :value="option.key">
          {{ option.label }}
        </option>
      </select>
      <KitMultiSelectFilter v-model="baseline" label="基线范围" :options="[{ key: 'baseline', label: '当前基线' }, { key: 'history', label: '历史/非基线' }]" full-width />
      <KitMultiSelectFilter v-model="status" label="状态" :options="statusOptions" full-width />
    </div>
  </div>
</template>
