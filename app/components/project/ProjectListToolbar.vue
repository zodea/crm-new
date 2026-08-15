<script setup lang="ts">
import { Button } from '~/components/ui/button'

defineProps<{
  realTotal: number
  demoTotal: number
  includeDemo: boolean
  visible: number
  loading: boolean
  importDisabledReason?: string
  createDisabledReason?: string
}>()

const emit = defineEmits<{
  create: []
  refresh: []
  /** 导出台账（单文件直接保存，ADR 0004） */
  exportLedger: []
  /** 分类导出（按客户/阶段分两级目录，配置导出页签，ADR 0004） */
  exportByCategory: []
  /** 导入映射页签（ADR 0005） */
  import: []
}>()

const search = defineModel<string>('search', { required: true })
const sortMode = defineModel<'updated-desc' | 'name-asc'>('sortMode', { required: true })
const filtersVisible = defineModel<boolean>('filtersVisible', { required: true })
const density = defineModel<'compact' | 'comfortable'>('density', { required: true })

function toggleSort() {
  sortMode.value = sortMode.value === 'updated-desc' ? 'name-asc' : 'updated-desc'
}

function toggleDensity() {
  density.value = density.value === 'compact' ? 'comfortable' : 'compact'
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden p-2.5">
    <div
      data-testid="project-list-toolbar-scroll"
      class="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5"
      aria-label="项目列表工具栏"
    >
      <div class="mr-1 flex min-w-max flex-none items-baseline gap-2 px-1">
        <h2 class="text-14px font-800 text-ink">
          施工项目
        </h2>
        <span class="text-12px text-ink-soft" aria-label="项目来源数量">
          正式 <b class="font-mono text-ink">{{ realTotal }}</b> 个
          <template v-if="includeDemo">· 测试 <b class="font-mono text-warn">{{ demoTotal }}</b> 个</template>
          <template v-if="visible !== realTotal + (includeDemo ? demoTotal : 0)">· 当前筛选 {{ visible }} 个</template>
        </span>
      </div>

      <div class="ml-auto flex min-w-max items-center gap-2">
        <SearchInput v-model="search" placeholder="搜索项目、客户、经理…" :width="220" />
        <Button
          variant="outline"
          size="icon"
          title="刷新项目列表"
          aria-label="刷新项目列表"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <span
            class="i-lucide-refresh-cw h-3.5 w-3.5"
            :class="loading ? 'animate-spin' : ''"
            aria-hidden="true"
          />
        </Button>
        <Button
          variant="outline"
          size="icon"
          :title="sortMode === 'updated-desc' ? '当前按最近更新排序，点击改为项目名称排序' : '当前按项目名称排序，点击改为最近更新排序'"
          aria-label="切换项目排序"
          @click="toggleSort"
        >
          <span class="i-lucide-arrow-up-down h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          title="显示或隐藏阶段筛选"
          aria-label="显示或隐藏阶段筛选"
          :aria-pressed="filtersVisible"
          @click="filtersVisible = !filtersVisible"
        >
          <span class="i-lucide-list-filter h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          :title="density === 'compact' ? '当前为紧凑表格，点击切换舒适密度' : '当前为舒适表格，点击切换紧凑密度'"
          aria-label="切换表格密度"
          @click="toggleDensity"
        >
          <span class="i-lucide-settings-2 h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          aria-label="导入项目"
          :title="importDisabledReason || '导入项目（映射页签）'"
          :disabled="Boolean(importDisabledReason)"
          @click="emit('import')"
        >
          <span class="i-lucide-upload h-3.5 w-3.5" aria-hidden="true" />
          导入
        </Button>
        <Button variant="outline" title="导出项目台账（单文件直接保存）" @click="emit('exportLedger')">
          <span class="i-lucide-download h-3.5 w-3.5" aria-hidden="true" />
          导出台账
        </Button>
        <Button variant="outline" title="按客户/阶段分类导出（配置页签）" @click="emit('exportByCategory')">
          <span class="i-lucide-folder-tree h-3.5 w-3.5" aria-hidden="true" />
          分类导出
        </Button>
        <Button
          variant="accent"
          aria-label="新增项目"
          :title="createDisabledReason || '新增正式项目'"
          :disabled="Boolean(createDisabledReason)"
          @click="emit('create')"
        >
          <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
          新增项目
        </Button>
      </div>
    </div>
  </section>
</template>
