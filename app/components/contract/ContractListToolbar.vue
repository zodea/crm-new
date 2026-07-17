<script setup lang="ts">
import { Button } from '~/components/ui/button'

interface ProjectOption {
  key: string
  label: string
}

defineProps<{
  title: string
  total: number
  visible: number
  loading: boolean
  projectOptions: ProjectOption[]
}>()

const emit = defineEmits<{
  create: []
  refresh: []
}>()

const search = defineModel<string>('search', { required: true })
const project = defineModel<string>('project', { required: true })
</script>

<template>
  <section class="flex flex-wrap items-center gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3.5 shadow-[var(--shadow-card)]">
    <div class="mr-1 flex flex-none items-baseline gap-2">
      <h2 class="text-14px font-800 text-ink">
        {{ title }}
      </h2>
      <span class="text-12px text-ink-soft">
        共 <b class="font-mono text-ink">{{ total }}</b> 份
        <template v-if="visible !== total">· 当前 {{ visible }} 份</template>
      </span>
    </div>

    <SelectFilter
      v-model="project"
      label="项目"
      :options="projectOptions"
      placeholder="全部项目"
      :min-width="160"
    />

    <div class="ml-auto flex flex-wrap items-center gap-2.5">
      <SearchInput v-model="search" placeholder="搜索合同名称 / 编号" :width="220" />
      <Button variant="outline" size="icon" title="刷新" :disabled="loading" @click="emit('refresh')">
        <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
        <span class="sr-only">刷新</span>
      </Button>
      <Button variant="accent" @click="emit('create')">
        <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
        新增{{ title }}
      </Button>
    </div>
  </section>
</template>
