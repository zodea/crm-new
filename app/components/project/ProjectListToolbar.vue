<script setup lang="ts">
import { Button } from '~/components/ui/button'

interface StatusOption {
  key: string
  label: string
}

defineProps<{
  total: number
  visible: number
  loading: boolean
  statusOptions: StatusOption[]
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
const status = defineModel<string>('status', { required: true })
</script>

<template>
  <section
    class="panel flex flex-wrap items-center gap-3 p-3.5"
  >
    <div class="mr-1 flex flex-none items-baseline gap-2">
      <h2 class="text-14px font-800 text-ink">
        施工项目
      </h2>
      <span class="text-12px text-ink-soft">
        共 <b class="font-mono text-ink">{{ total }}</b> 个
        <template v-if="visible !== total">· 当前 {{ visible }} 个</template>
      </span>
    </div>

    <SelectFilter
      v-model="status"
      label="状态"
      :options="statusOptions"
      :min-width="150"
      placeholder="全部状态"
    />

    <div class="ml-auto flex flex-wrap items-center gap-2.5">
      <SearchInput v-model="search" placeholder="搜索项目、客户、经理…" :width="230" />
      <Button variant="outline" size="icon" title="刷新" :disabled="loading" @click="emit('refresh')">
        <span
          class="i-lucide-refresh-cw h-3.5 w-3.5"
          :class="loading ? 'animate-spin' : ''"
          aria-hidden="true"
        />
        <span class="sr-only">刷新</span>
      </Button>
      <Button variant="outline" title="导入项目（映射页签）" @click="emit('import')">
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
      <Button variant="accent" @click="emit('create')">
        <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
        新增项目
      </Button>
    </div>
  </section>
</template>
