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
import { yuan } from '~/lib/util/money'
import { maskIdentifier, maskPhone } from '~/lib/util/privacy'

const store = useSupplierStore()
const projectStore = useProjectStore()
const projectSupplierStore = useProjectSupplierStore()
const {
  confirm,
  formModal,
  typeSelect,
  undoToast,
  success,
  error,
  exportFile,
  openImportTab,
} = useKitUI()

const searchText = shallowRef('')
const categoryFilter = shallowRef('all')
const statusFilter = shallowRef('all')
const projectFilter = shallowRef('all')
const debtOnly = shallowRef(false)
const credentialMissingOnly = shallowRef(false)
const sort = shallowRef<SupplierListSort>('updated-desc')
const columnsExpanded = shallowRef(false)
const page = shallowRef(1)
const pageSize = shallowRef(10)
const loadError = shallowRef('')
let latestLoadRequest = 0

const categoryOptions = [
  { key: 'all', label: '全部类别' },
  ...SUPPLIER_CATEGORIES.map(category => ({ key: category, label: category })),
]
const statusOptions = [
  { key: 'all', label: '全部状态' },
  ...CREDENTIAL_STATUSES.map(status => ({ key: status, label: CREDENTIAL_STATUS_LABEL[status] ?? status })),
]
const projectOptions = computed(() => [
  { key: 'all', label: '全部项目' },
  ...store.projectOptions.map(project => ({ key: project.id, label: project.name })),
])
const associationProjectOptions = computed(() =>
  projectStore.list.map(project => ({
    id: project.id,
    label: `${project.name || project.id}（${project.id}）`,
  })),
)
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
  { field: 'uniqueCode', title: '统一社会信用代码', width: 190, slot: 'identityCode' },
  { field: 'aliases', title: '简称', width: 120, slot: 'aliases' },
  { field: 'credentialStatus', title: '资料状态', width: 100, slot: 'credentialStatus' },
  { field: 'contact', title: '主要联系人', width: 104 },
  { field: 'contactPhone', title: '联系方式', width: 126, slot: 'contactPhone' },
  { field: 'projectCount', title: '合作项目', width: 92, align: 'right', slot: 'projectCount' },
  { field: 'contractTotal', title: '累计合同额', width: 132, align: 'right', slot: 'contractTotal' },
  { field: 'paidTotal', title: '累计已付', width: 124, align: 'right', slot: 'paidTotal' },
]
const extendedColumns: KitTableColumn[] = [
  { field: 'mainBusiness', title: '主营业务', minWidth: 150 },
  { field: 'bank', title: '开户行', minWidth: 180 },
  { field: 'address', title: '注册地址', minWidth: 190 },
]
const columns = computed<KitTableColumn[]>(() => [
  ...coreColumns,
  ...(columnsExpanded.value ? extendedColumns : []),
  { title: '操作', type: 'action', width: 188 },
])

const filtered = computed(() =>
  filterSuppliers(store.list, {
    search: searchText.value,
    category: categoryFilter.value,
    credentialStatus: statusFilter.value,
  }).filter((supplier) => {
    const stats = store.listStats[supplier.id]
    if (projectFilter.value !== 'all' && !stats?.projectIds.includes(projectFilter.value))
      return false
    if (debtOnly.value && !((stats?.payableBalance ?? 0) > 0))
      return false
    if (credentialMissingOnly.value && supplier.credentialStatus !== 'incomplete')
      return false
    return true
  }),
)
const sorted = computed(() => sortSuppliers(filtered.value, sort.value))
const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(sorted.value, currentPage.value, pageSize.value))
const listSummary = computed(() => {
  const totals = filtered.value.reduce((result, supplier) => {
    const stats = store.listStats[supplier.id]
    result.contractTotal += stats?.contractTotal ?? 0
    result.paidTotal += stats?.paidTotal ?? 0
    return result
  }, { contractTotal: 0, paidTotal: 0 })
  return {
    当前分供方: `${filtered.value.length} 家`,
    累计合同额: yuan(totals.contractTotal),
    累计已付: yuan(totals.paidTotal),
  }
})

watch([searchText, categoryFilter, statusFilter, projectFilter, debtOnly, credentialMissingOnly, sort], () => {
  page.value = 1
})

function statusClass(status: string): string {
  const tone = CREDENTIAL_STATUS_TONE[status]
  return tone ? toneChip[tone] : 'chip bg-surface-3 text-ink-soft'
}

async function openCreate() {
  const category = await typeSelect({
    title: '选择分供方类别',
    options: SUPPLIER_CATEGORIES.map(item => ({
      value: item,
      label: item,
    })),
    defaultValue: SUPPLIER_CATEGORIES[0],
    confirmLabel: '进入新建表单',
  })
  if (!category)
    return
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
  projectFilter.value = 'all'
  debtOnly.value = false
  credentialMissingOnly.value = false
  sort.value = 'updated-desc'
  await loadListData()
}

async function loadListData() {
  const request = ++latestLoadRequest
  loadError.value = ''
  try {
    await Promise.all([
      store.load(),
      projectStore.load(),
      projectSupplierStore.load(),
    ])
  }
  catch (cause) {
    if (request === latestLoadRequest)
      loadError.value = toErrorMessage(cause)
  }
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

async function associateProject(supplier: DeepReadonly<Supplier>) {
  if (!associationProjectOptions.value.length) {
    error('暂无可关联项目，请先建立项目主数据')
    return
  }
  const values = await formModal({
    title: '关联合作项目',
    subtitle: `为“${supplier.name}”建立项目合作关系；已有关系会直接复用。`,
    saveText: '确认关联',
    fields: [{
      key: 'project',
      label: '项目',
      type: 'select',
      value: associationProjectOptions.value[0]!.label,
      options: associationProjectOptions.value.map(project => project.label),
      required: true,
    }],
  })
  if (!values)
    return

  const selected = associationProjectOptions.value.find(project =>
    project.label === String(values.project),
  )
  if (!selected) {
    error('所选项目不存在或已删除')
    return
  }

  try {
    const reused = Boolean(projectSupplierStore.byProjectAndSupplier(selected.id, supplier.id))
    await projectSupplierStore.add(selected.id, supplier.id)
    await store.load()
    success(reused ? '该合作关系已存在，已为你保留原记录' : '合作项目已关联')
  }
  catch (cause) {
    error(`关联失败：${toErrorMessage(cause)}`)
  }
}

onMounted(() => {
  void loadListData()
})
</script>

<template>
  <div class="min-w-0 grid gap-3">
    <StatePanel
      v-if="loadError"
      kind="error"
      title="分供方列表加载失败"
      :description="loadError"
      action-label="重新加载"
      :compact="store.list.length > 0"
      @action="loadListData"
    />

    <ListShell v-if="!loadError || store.list.length" :summary="listSummary">
      <template #toolbar>
        <SupplierListToolbar
          v-model:search="searchText"
          v-model:category="categoryFilter"
          v-model:credential-status="statusFilter"
          v-model:project="projectFilter"
          v-model:debt-only="debtOnly"
          v-model:credential-missing-only="credentialMissingOnly"
          v-model:sort="sort"
          :total="store.list.length"
          :visible="filtered.length"
          :loading="store.loading"
          :category-options="categoryOptions"
          :status-options="statusOptions"
          :project-options="projectOptions"
          :sort-options="sortOptions"
          :columns-expanded="columnsExpanded"
          @refresh="refresh"
          @create="openCreate"
          @import="openImport"
          @toggle-columns="columnsExpanded = !columnsExpanded"
          @export-ledger="exportLedger"
          @export-by-category="exportByCategory"
        />
      </template>

      <template #table>
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

            <template #identityCode="{ row }">
              <span class="font-mono" :title="row.uniqueCode || row.taxNo ? '已脱敏显示' : ''">
                {{ maskIdentifier(row.uniqueCode || row.taxNo) || '—' }}
              </span>
            </template>

            <template #contactPhone="{ row }">
              <span class="font-mono" :title="row.contactPhone ? '已脱敏显示' : ''">
                {{ maskPhone(row.contactPhone) || '—' }}
              </span>
            </template>

            <template #projectCount="{ row }">
              <span class="font-mono">{{ store.listStats[row.id]?.projectCount ?? 0 }}</span>
            </template>

            <template #contractTotal="{ row }">
              <span class="font-mono">{{ yuan(store.listStats[row.id]?.contractTotal ?? 0) }}</span>
            </template>

            <template #paidTotal="{ row }">
              <span class="font-mono">{{ yuan(store.listStats[row.id]?.paidTotal ?? 0) }}</span>
            </template>

            <template #action="{ row }">
              <div class="flex items-center justify-end gap-1">
                <NuxtLink :to="`/base/supplier/${row.id}`" class="icon-btn" title="详情" aria-label="查看分供方详情">
                  <span class="i-lucide-file-text text-14px" aria-hidden="true" />
                </NuxtLink>
                <button class="icon-btn" title="编辑" aria-label="编辑分供方" @click="openEdit(row)">
                  <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
                </button>
                <NuxtLink
                  :to="`/base/supplier/${row.id}?tab=credential`"
                  class="icon-btn"
                  title="证照资料"
                  aria-label="维护分供方证照"
                >
                  <span class="i-lucide-shield-check text-14px" aria-hidden="true" />
                </NuxtLink>
                <button
                  type="button"
                  class="icon-btn"
                  title="关联项目"
                  aria-label="关联分供方项目"
                  @click="associateProject(row)"
                >
                  <span class="i-lucide-folders text-14px" aria-hidden="true" />
                </button>
                <button class="icon-btn-danger" title="删除" aria-label="删除分供方" @click="handleDelete(row)">
                  <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
                </button>
              </div>
            </template>
          </KitTable>
        </div>
      </template>
    </ListShell>
  </div>
</template>
