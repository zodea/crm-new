<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { StatusTone } from '~/lib/supplier/status'
import type { Supplier } from '~/stores/supplier'
import { clampPage, paginate } from '~/lib/kit/table'
import { filterSuppliers } from '~/lib/supplier/list'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE, CREDENTIAL_STATUSES, SUPPLIER_CATEGORIES } from '~/lib/supplier/status'

const store = useSupplierStore()
const { confirm, undoToast, success, error } = useKitUI()

const searchText = shallowRef('')
const categoryFilter = shallowRef('all')
const statusFilter = shallowRef('all')
const page = shallowRef(1)
const pageSize = shallowRef(10)
const showForm = shallowRef(false)
const editingRow = shallowRef<Supplier | null>(null)

const categoryOptions = [
  { key: 'all', label: '全部类别' },
  ...SUPPLIER_CATEGORIES.map(category => ({ key: category, label: category })),
]
const statusOptions = [
  { key: 'all', label: '全部状态' },
  ...CREDENTIAL_STATUSES.map(status => ({ key: status, label: CREDENTIAL_STATUS_LABEL[status] ?? status })),
]

const toneChip: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  ok: 'chip-ok',
  danger: 'chip-danger',
}

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'name', title: '分供方名称', minWidth: 190, fixed: 'left', slot: 'name' },
  { field: 'supplierCategory', title: '分供方类别', width: 118 },
  { field: 'uniqueCode', title: '统一社会信用代码', width: 190 },
  { field: 'aliases', title: '简称', width: 120, slot: 'aliases' },
  { field: 'credentialStatus', title: '资料状态', width: 100, slot: 'credentialStatus' },
  { field: 'contact', title: '主要联系人', width: 104 },
  { field: 'contactPhone', title: '联系方式', width: 126 },
  { field: 'mainBusiness', title: '主营业务', minWidth: 150 },
  { field: 'bank', title: '开户行', minWidth: 180 },
  { field: 'address', title: '注册地址', minWidth: 190 },
  { title: '操作', type: 'action', width: 130 },
]

const filtered = computed(() => filterSuppliers(store.list, {
  search: searchText.value,
  category: categoryFilter.value,
  credentialStatus: statusFilter.value,
}))
const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))

watch([searchText, categoryFilter, statusFilter], () => {
  page.value = 1
})

function statusClass(status: string): string {
  const tone = CREDENTIAL_STATUS_TONE[status]
  return tone ? toneChip[tone] : 'chip bg-surface-3 text-ink-soft'
}

function openCreate() {
  editingRow.value = null
  showForm.value = true
}

function openEdit(supplier: DeepReadonly<Supplier>) {
  editingRow.value = { ...supplier, aliases: [...supplier.aliases] } as Supplier
  showForm.value = true
}

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

async function refresh() {
  searchText.value = ''
  categoryFilter.value = 'all'
  statusFilter.value = 'all'
  await store.load()
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
  <div class="flex min-w-0 flex-col gap-4">
    <SupplierListToolbar
      v-model:search="searchText"
      v-model:category="categoryFilter"
      v-model:credential-status="statusFilter"
      :total="store.list.length"
      :visible="filtered.length"
      :loading="store.loading"
      :category-options="categoryOptions"
      :status-options="statusOptions"
      @refresh="refresh"
      @create="openCreate"
    />

    <KitTable
      class="overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-card)]"
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

    <SupplierFormDialog v-model:open="showForm" :supplier="editingRow" />
  </div>
</template>
