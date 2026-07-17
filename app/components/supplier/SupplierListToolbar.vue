<script setup lang="ts">
import { Button } from '~/components/ui/button'

interface FilterOption {
  key: string
  label: string
}

defineProps<{
  total: number
  visible: number
  loading: boolean
  categoryOptions: FilterOption[]
  statusOptions: FilterOption[]
}>()

const emit = defineEmits<{
  create: []
  refresh: []
  import: []
  exportLedger: []
  exportByCategory: []
}>()

const search = defineModel<string>('search', { required: true })
const category = defineModel<string>('category', { required: true })
const credentialStatus = defineModel<string>('credentialStatus', { required: true })
</script>

<template>
  <section
    class="panel flex flex-wrap items-center gap-3 p-3.5"
  >
    <div class="mr-1 flex flex-none items-baseline gap-2">
      <h2 class="text-14px font-800 text-ink">
        分供方资料库
      </h2>
      <span class="text-12px text-ink-soft">
        共 <b class="font-mono text-ink">{{ total }}</b> 家
        <template v-if="visible !== total">· 当前 {{ visible }} 家</template>
      </span>
    </div>

    <SelectFilter v-model="category" label="类别" :options="categoryOptions" :min-width="145" />
    <SelectFilter v-model="credentialStatus" label="资料" :options="statusOptions" :min-width="132" />

    <div class="ml-auto flex flex-wrap items-center gap-2.5">
      <SearchInput v-model="search" placeholder="搜索公司名、税号、简称…" :width="230" />
      <Button variant="outline" size="icon" title="刷新" :disabled="loading" @click="emit('refresh')">
        <span
          class="i-lucide-refresh-cw h-3.5 w-3.5"
          :class="loading ? 'animate-spin' : ''"
          aria-hidden="true"
        />
        <span class="sr-only">刷新</span>
      </Button>
      <Button variant="outline" title="导入分供方（映射页签）" @click="emit('import')">
        <span class="i-lucide-upload h-3.5 w-3.5" aria-hidden="true" />
        导入
      </Button>
      <Button variant="outline" title="导出分供方台账（单文件直接保存）" @click="emit('exportLedger')">
        <span class="i-lucide-download h-3.5 w-3.5" aria-hidden="true" />
        导出台账
      </Button>
      <Button variant="outline" title="按类别/资料状态分类导出（配置页签）" @click="emit('exportByCategory')">
        <span class="i-lucide-folder-tree h-3.5 w-3.5" aria-hidden="true" />
        分类导出
      </Button>
      <Button variant="accent" @click="emit('create')">
        <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
        新增分供方
      </Button>
    </div>
  </section>
</template>
