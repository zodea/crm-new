<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { SupplierListSort } from '~/lib/supplier/list'
import type { StatusTone } from '~/lib/supplier/status'
import type { Supplier } from '~/stores/supplier'
import { clampPage, paginate } from '~/lib/kit/table'
import { createSupplierCategoryExport, createSupplierLedgerExport } from '~/lib/supplier/export'
import { filterSuppliers, sortSuppliers } from '~/lib/supplier/list'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE, CREDENTIAL_STATUSES, SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { toErrorMessage } from '~/lib/util/error'

const store = useSupplierStore()
const { confirm, undoToast, success, error, exportFile, openImportTab } = useKitUI()

const searchText = shallowRef('')
const categoryFilter = shallowRef('all')
const statusFilter = shallowRef('all')
const sort = shallowRef<SupplierListSort>('updated-desc')
const columnsExpanded = shallowRef(false)
const typeDialogOpen = shallowRef(false)
const page = shallowRef(1)
const pageSize = shallowRef(10)

const categoryOptions = [
  { key: 'all', label: '全部类别' },
  ...SUPPLIER_CATEGORIES.map(category => ({ key: category, label: category })),
]
const statusOptions = [
  { key: 'all', label: '全部状态' },
  ...CREDENTIAL_STATUSES.map(status => ({ key: status, label: CREDENTIAL_STATUS_LABEL[status] ?? status })),
]
const sortOptions = [
  { key: 'updated-desc', label: '最近更新' },
  { key: 'name-asc', label: '名称升序' },
  { key: 'name-desc', label: '名称降序' },
  { key: 'category-asc', label: '类别升序' },
]

const toneChip: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  ok: 'chip-ok',
  danger: 'chip-danger',
}

const coreColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'name', title: '分供方名称', minWidth: 190, fixed: 'left', slot: 'name' },
  { field: 'supplierCategory', title: '分供方类别', width: 118 },
  { field: 'uniqueCode', title: '统一社会信用代码', width: 190 },
  { field: 'aliases', title: '简称', width: 120, slot: 'aliases' },
  { field: 'credentialStatus', title: '资料状态', width: 100, slot: 'credentialStatus' },
  { field: 'contact', title: '主要联系人', width: 104 },
  { field: 'contactPhone', title: '联系方式', width: 126 },
]
const extendedColumns: KitTableColumn[] = [
  { field: 'mainBusiness', title: '主营业务', minWidth: 150 },
  { field: 'bank', title: '开户行', minWidth: 180 },
  { field: 'address', title: '注册地址', minWidth: 190 },
]
const columns = computed<KitTableColumn[]>(() => [
  ...coreColumns,
  ...(columnsExpanded.value ? extendedColumns : []),
  { title: '操作', type: 'action' },
])

const filtered = computed(() => filterSuppliers(store.list, {
  search: searchText.value,
  category: categoryFilter.value,
  credentialStatus: statusFilter.value,
}))
const sorted = computed(() => sortSuppliers(filtered.value, sort.value))
const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(sorted.value, currentPage.value, pageSize.value))

watch([searchText, categoryFilter, statusFilter, sort], () => {
  page.value = 1
})

function statusClass(status: string): string {
  const tone = CREDENTIAL_STATUS_TONE[status]
  return tone ? toneChip[tone] : 'chip bg-surface-3 text-ink-soft'
}

function openCreate() {
  typeDialogOpen.value = true
}

function confirmCreate(category: string) {
  void navigateTo({
    path: '/base/supplier/form',
    query: { category },
  })
}

function openEdit(supplier: DeepReadonly<Supplier>) {
  void navigateTo(`/base/supplier/form/${supplier.id}`)
}

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

async function refresh() {
  searchText.value = ''
  categoryFilter.value = 'all'
  statusFilter.value = 'all'
  sort.value = 'updated-desc'
  await store.load()
}

// 导出路一：当前筛选结果合成一个分供方台账，直接选择目录保存。
async function exportLedger() {
  if (!filtered.value.length) {
    error('当前没有可导出的分供方')
    return
  }
  try {
    await exportFile(createSupplierLedgerExport(filtered.value))
  }
  catch (err) {
    error(`导出失败：${toErrorMessage(err)}`)
  }
}

// 导出路二：类别/资料状态两级目录，每家分供方一个文件，进入 ADR 0004 配置页签。
async function exportByCategory() {
  if (!filtered.value.length) {
    error('当前没有可导出的分供方')
    return
  }
  try {
    await exportFile(createSupplierCategoryExport(filtered.value))
  }
  catch (err) {
    error(`分类导出失败：${toErrorMessage(err)}`)
  }
}

async function openImport() {
  try {
    await openImportTab({ entity: 'supplier' })
  }
  catch (err) {
    error(`导入打开失败：${toErrorMessage(err)}`)
  }
}

async function handleDelete(supplier: DeepReadonly<Supplier>) {
  const impact = await store.downstreamImpact(supplier.id)
  const cascade = impact.length > 0
  const confirmed = await confirm(cascade
    ? {
        variant: 'cascade',
        title: '删除分供方',
        message: `“${supplier.name}”挂有下游数据，删除后其下游数据一并隐藏。`,
        requireTyping: supplier.name,
        impact,
        confirmLabel: '删除',
      }
    : {
        variant: 'simple',
        title: '删除分供方',
        message: `确认删除分供方「${supplier.name}」？删除后可在 10 秒内撤回。`,
        confirmLabel: '删除',
      })

  if (!confirmed)
    return

  const logId = await store.remove(supplier.id)
  if (!logId) {
    error('删除失败：分供方不存在或已删除')
    return
  }
  if (cascade)
    success(`已删除「${supplier.name}」及其下游数据`)
  else
    undoToast(`已删除「${supplier.name}」`, () => store.undo(logId))
}

onMounted(() => store.load())
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <SupplierListToolbar
      v-model:search="searchText"
      v-model:category="categoryFilter"
      v-model:credential-status="statusFilter"
      v-model:sort="sort"
      :total="store.list.length"
      :visible="filtered.length"
      :loading="store.loading"
      :category-options="categoryOptions"
      :status-options="statusOptions"
      :sort-options="sortOptions"
      :columns-expanded="columnsExpanded"
      @refresh="refresh"
      @create="openCreate"
      @import="openImport"
      @toggle-columns="columnsExpanded = !columnsExpanded"
      @export-ledger="exportLedger"
      @export-by-category="exportByCategory"
    />

    <div data-ui="supplier-list-table" class="min-w-0 max-w-full">
      <KitTable
        :columns="columns"
        :data="pageRows"
        :loading="store.loading"
        :page="{ page: currentPage, pageSize, total: filtered.length }"
        empty="没有符合筛选条件的分供方"
        @page-change="handlePageChange"
      >
        <template #name="{ row }">
          <NuxtLink :to="`/base/supplier/${row.id}`" class="cell--link">
            {{ row.name }}
          </NuxtLink>
        </template>

        <template #aliases="{ row }">
          {{ row.aliases.join('、') || '—' }}
        </template>

        <template #credentialStatus="{ row }">
          <span :class="statusClass(row.credentialStatus)">
            {{ CREDENTIAL_STATUS_LABEL[row.credentialStatus] || row.credentialStatus }}
          </span>
        </template>

        <template #action="{ row }">
          <div class="flex items-center justify-end gap-1">
            <NuxtLink :to="`/base/supplier/${row.id}`" class="icon-btn" title="详情" aria-label="查看分供方详情">
              <span class="i-lucide-file-text text-14px" aria-hidden="true" />
            </NuxtLink>
            <button class="icon-btn" title="编辑" aria-label="编辑分供方" @click="openEdit(row)">
              <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
            </button>
            <button class="icon-btn-danger" title="删除" aria-label="删除分供方" @click="handleDelete(row)">
              <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
            </button>
          </div>
        </template>
      </KitTable>
    </div>

    <SupplierTypeSelectDialog
      v-model:open="typeDialogOpen"
      @confirm="confirmCreate"
    />
  </div>
</template>
