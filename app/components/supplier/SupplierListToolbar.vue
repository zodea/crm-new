<script setup lang="ts">
import type { SupplierListSort } from '~/lib/supplier/list'
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
  projectOptions: FilterOption[]
  sortOptions: FilterOption[]
  columnsExpanded: boolean
}>()

const emit = defineEmits<{
  create: []
  refresh: []
  import: []
  toggleColumns: []
  exportLedger: []
  exportByCategory: []
}>()

const search = defineModel<string>('search', { required: true })
const category = defineModel<string>('category', { required: true })
const credentialStatus = defineModel<string>('credentialStatus', { required: true })
const project = defineModel<string>('project', { required: true })
const debtOnly = defineModel<boolean>('debtOnly', { required: true })
const credentialMissingOnly = defineModel<boolean>('credentialMissingOnly', { required: true })
const sort = defineModel<SupplierListSort>('sort', { required: true })
</script>

<template>
  <section
    data-ui="supplier-list-toolbar"
    class="panel min-w-0 max-w-full p-2.5"
  >
    <div
      data-ui="supplier-list-toolbar-row"
      class="flex min-w-0 flex-nowrap items-center gap-2"
    >
      <div class="mr-1 flex flex-none items-baseline gap-2">
        <h2 class="text-14px font-800 text-ink">
          分供方资料库
        </h2>
        <span class="whitespace-nowrap text-12px text-ink-soft">
          共 <b class="font-mono text-ink">{{ total }}</b> 家
          <template v-if="visible !== total">· 当前 {{ visible }} 家</template>
        </span>
      </div>

      <div
        data-ui="supplier-list-toolbar-scroll"
        class="min-w-0 flex-1 overflow-x-auto"
      >
        <div class="flex min-w-max flex-nowrap items-center gap-2 pr-1">
          <SearchInput v-model="search" placeholder="搜索公司名、税号、简称…" :width="230" />
          <Button variant="outline" size="icon" title="刷新" :disabled="loading" @click="emit('refresh')">
            <span
              class="i-lucide-refresh-cw h-3.5 w-3.5"
              :class="loading ? 'animate-spin' : ''"
              aria-hidden="true"
            />
            <span class="sr-only">刷新</span>
          </Button>
          <SelectFilter v-model="sort" label="排序" :options="sortOptions" :min-width="132" />
          <SelectFilter v-model="category" label="类别" :options="categoryOptions" :min-width="145" />
          <SelectFilter v-model="credentialStatus" label="资料" :options="statusOptions" :min-width="132" />
          <SelectFilter v-model="project" label="项目" :options="projectOptions" :min-width="150" />
          <Button
            variant="outline"
            :aria-pressed="debtOnly"
            :class="debtOnly ? 'border-brand text-brand-deep' : ''"
            @click="debtOnly = !debtOnly"
          >
            欠款
          </Button>
          <Button
            variant="outline"
            :aria-pressed="credentialMissingOnly"
            :class="credentialMissingOnly ? 'border-brand text-brand-deep' : ''"
            @click="credentialMissingOnly = !credentialMissingOnly"
          >
            证照缺失
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="列设置"
            :aria-pressed="columnsExpanded"
            @click="emit('toggleColumns')"
          >
            <span class="i-lucide-settings-2 h-3.5 w-3.5" aria-hidden="true" />
            <span class="sr-only">列设置</span>
          </Button>
          <Button
            variant="outline"
            aria-label="导入分供方"
            title="导入分供方（映射页签）"
            @click="emit('import')"
          >
            <span class="i-lucide-upload h-3.5 w-3.5" aria-hidden="true" />
            导入
          </Button>
          <Button
            variant="outline"
            aria-label="导出分供方台账"
            title="导出分供方台账（单文件直接保存）"
            @click="emit('exportLedger')"
          >
            <span class="i-lucide-download h-3.5 w-3.5" aria-hidden="true" />
            导出台账
          </Button>
          <Button
            variant="outline"
            aria-label="分类导出分供方"
            title="按类别/资料状态分类导出（配置页签）"
            @click="emit('exportByCategory')"
          >
            <span class="i-lucide-folder-tree h-3.5 w-3.5" aria-hidden="true" />
            分类导出
          </Button>
        </div>
      </div>

      <Button class="flex-none" variant="accent" @click="emit('create')">
        <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
        新增分供方
      </Button>
    </div>
  </section>
</template>
