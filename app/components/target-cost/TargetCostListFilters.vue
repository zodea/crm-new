<script setup lang="ts">
interface FilterOption {
  key: string
  label: string
}

defineProps<{
  loading: boolean
  projectOptions: readonly FilterOption[]
  statusOptions: readonly FilterOption[]
}>()

const emit = defineEmits<{
  refresh: []
  create: []
}>()

const search = defineModel<string>('search', { required: true })
const project = defineModel<string>('project', { required: true })
const baseline = defineModel<'all' | 'baseline' | 'history'>('baseline', { required: true })
const status = defineModel<string>('status', { required: true })
</script>

<template>
  <header class="panel flex min-w-0 flex-col gap-3 px-4 py-3">
    <div class="flex min-w-0 flex-wrap items-center gap-3">
      <div class="mr-auto min-w-0">
        <h1 class="text-17px font-800 text-ink">
          目标成本列表
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          按项目管理预算版本，当前基线用于项目成本动态对比。
        </p>
      </div>
      <KitButton type="button" variant="secondary" :loading="loading" @click="emit('refresh')">
        <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />
        刷新
      </KitButton>
      <KitButton type="button" variant="primary" @click="emit('create')">
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
      <label class="sr-only" for="target-cost-baseline-filter">基线范围</label>
      <select
        id="target-cost-baseline-filter"
        v-model="baseline"
        class="field-input h-8 min-w-0 text-12px"
      >
        <option value="all">
          全部版本
        </option>
        <option value="baseline">
          当前基线
        </option>
        <option value="history">
          历史/非基线
        </option>
      </select>
      <label class="sr-only" for="target-cost-status-filter">状态</label>
      <select
        id="target-cost-status-filter"
        v-model="status"
        class="field-input h-8 min-w-0 text-12px"
      >
        <option v-for="option in statusOptions" :key="option.key" :value="option.key">
          {{ option.label }}
        </option>
      </select>
    </div>
  </header>
</template>
