<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { SupplierListSort } from '~/lib/supplier/repository'

defineProps<{
  loading: boolean
  columns: KitTableColumn[]
  categoryOptions: { key: string, label: string }[]
  credentialOptions: { key: string, label: string }[]
  hasFilters: boolean
  canWrite: boolean
}>()
const emit = defineEmits<{ refresh: [], create: [], import: [], clear: [], resetView: [] }>()
const search = defineModel<string>('search', { required: true })
const category = defineModel<string>('category', { required: true })
const credentialStatus = defineModel<string>('credentialStatus', { required: true })
const sort = defineModel<SupplierListSort>('sort', { required: true })
const hiddenColumns = defineModel<string[]>('hiddenColumns', { required: true })
const comfortable = defineModel<boolean>('comfortable', { required: true })

function toggleColumn(field: string) {
  hiddenColumns.value = hiddenColumns.value.includes(field)
    ? hiddenColumns.value.filter(value => value !== field)
    : [...hiddenColumns.value, field]
}
</script>

<template>
  <section data-ui="supplier-list-toolbar" class="supplier-list-controls min-w-0" data-supplier-list-return-fallback tabindex="-1">
    <div class="supplier-list-controls__heading">
      <span class="i-lucide-file-spreadsheet h-3.5 w-3.5 text-brand" aria-hidden="true" />
      <h2 class="text-13px font-500">
        全部分供方
      </h2>
    </div>
    <div data-ui="supplier-list-toolbar-row" class="supplier-list-controls__actions">
      <SearchInput v-model="search" placeholder="搜索关键词…" :width="200" :maxlength="120" />
      <div class="flex shrink-0 gap-1">
        <button type="button" class="list-tool-button" title="刷新" aria-label="刷新" :disabled="loading" @click="emit('refresh')">
          <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
        </button>
        <KitToolbarPopover label="排序" icon="i-lucide-list-ordered" :active="sort !== 'updated-desc'">
          <label class="grid gap-2">排序
            <select v-model="sort" class="h-8 border border-line rounded-sm bg-panel px-2" aria-label="排序方式">
              <option value="updated-desc">最近更新</option>
              <option value="name-asc">名称升序</option>
              <option value="name-desc">名称降序</option>
              <option value="category-asc">类别升序</option>
              <option value="settlementAmount-asc">累计结算金额升序</option>
              <option value="settlementAmount-desc">累计结算金额降序</option>
              <option value="cumulativeContractAmount-asc">累计合同金额升序</option>
              <option value="cumulativeContractAmount-desc">累计合同金额降序</option>
              <option value="contractAmount-asc">有效合同额升序</option>
              <option value="contractAmount-desc">有效合同额降序</option>
              <option value="paymentAmount-asc">确认实付升序</option>
              <option value="paymentAmount-desc">确认实付降序</option>
              <option value="projectCount-asc">合作项目数升序</option>
              <option value="projectCount-desc">合作项目数降序</option>
            </select>
          </label>
        </KitToolbarPopover>
        <KitToolbarPopover label="筛选" icon="i-lucide-filter" :active="hasFilters">
          <div class="grid gap-3">
            <SelectFilter v-model="category" label="类别" :options="categoryOptions" :min-width="160" />
            <SelectFilter v-model="credentialStatus" label="资料" :options="credentialOptions" :min-width="160" />
            <button type="button" class="btn-secondary justify-center" @click="emit('clear')">
              清除全部筛选
            </button>
          </div>
        </KitToolbarPopover>
        <KitToolbarPopover label="列设置" icon="i-lucide-settings">
          <div class="flex items-center justify-between border-b border-line pb-2">
            <strong class="font-600">显示列</strong>
            <button type="button" class="text-brand" @click="emit('resetView')">
              恢复默认
            </button>
          </div>
          <label v-for="column in columns.filter(item => item.field)" :key="column.field" class="flex items-center gap-2 py-1.5">
            <input type="checkbox" :checked="!hiddenColumns.includes(column.field!)" :disabled="column.field === 'name'" @change="toggleColumn(column.field!)">
            {{ column.title }}
          </label>
          <label class="mt-2 flex items-center gap-2 border-t border-line pt-2"><input v-model="comfortable" type="checkbox">舒适行高</label>
        </KitToolbarPopover>
      </div>
      <button type="button" class="list-action-button" aria-label="导入分供方" :disabled="!canWrite" @click="emit('import')">
        导入
      </button>
      <button type="button" class="list-action-button is-primary" aria-label="新增分供方" :disabled="!canWrite" @click="emit('create')">
        新建
      </button>
    </div>
  </section>
</template>

<style scoped>
.supplier-list-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.supplier-list-controls__heading { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; color: var(--ink-soft); }
.supplier-list-controls__actions { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 5px; }
.supplier-list-controls :deep(input[type='search']) { height: 28px; border-radius: 2px; font-size: 12px; }
.list-action-button { height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 2px; background: var(--panel); color: var(--ink); font-size: 12px; white-space: nowrap; cursor: pointer; }
.list-action-button.is-primary { background: var(--brand); border-color: var(--brand); color: white; }
.list-action-button:disabled { opacity: .45; cursor: not-allowed; }
.list-action-button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
@media (max-width: 767px) {
  .supplier-list-controls { flex-wrap: wrap; }
  .supplier-list-controls__actions { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
}
</style>
