<script setup lang="ts">
import type { ColumnFilterValue } from '~/components/ui/KitColumnHeader.vue'
import type { KitStatusTone } from '~/components/ui/KitStatusTag.vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type {
  MaterialFormKind,
  MaterialFormRecordMap,
} from '~/lib/material/forms'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'
import KitEnumFilterOptions from '~/components/ui/KitEnumFilterOptions.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import KitToolbarPopover from '~/components/ui/KitToolbarPopover.vue'
import ListShell from '~/components/ui/ListShell.vue'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'
import { MATERIAL_FORM_META, materialFormPath } from '~/lib/material/page'

type MaterialRecord = MaterialFormRecordMap[MaterialFormKind]

interface MaterialListRow {
  id: string
  no: string
  name: string
  projectId: string | null
  projectName: string
  quantity: number
  unit: string
  date: string
  status: string
  statusValue: string
}

const props = defineProps<{
  kind: MaterialFormKind
}>()

const materialStore = useMaterialStore()
const projectStore = useProjectStore()
const { confirm, undoToast, error } = useKitUI()
const meta = computed(() => MATERIAL_FORM_META[props.kind])
const search = shallowRef('')
const projectFilter = shallowRef<string[]>([])
const statusFilter = shallowRef<string[]>([])
const page = shallowRef(1)
const pageSize = shallowRef(10)
const filtersOpen = shallowRef(false)
const hasFilters = computed(() => projectFilter.value.length > 0 || statusFilter.value.length > 0)
const statusTones: Record<string, KitStatusTone> = { draft: 'neutral', submitted: 'brand', posted: 'ok', effective: 'ok', confirmed: 'ok' }

const records = computed(() =>
  (materialStore.records[props.kind] ?? []) as MaterialRecord[],
)

function statusLabel(status: string): string {
  return {
    draft: '草稿',
    submitted: '已提交',
    posted: '已过账',
    effective: '已生效',
    confirmed: '已确认',
  }[status] ?? status
}

function rowFrom(record: MaterialRecord): MaterialListRow {
  const value = record as unknown as Record<string, unknown>
  const projectId = typeof value.projectId === 'string' ? value.projectId : null
  const quantity = Number(
    value.totalQty
    ?? value.plannedQty
    ?? value.controlQty
    ?? value.qty
    ?? value.itemCount
    ?? 0,
  ) || 0
  const materialName = String(
    value.materialSummary
    ?? value.materialName
    ?? value.warehouse
    ?? '',
  )
  const date = String(
    value.requisitionDate
    ?? value.applicationDate
    ?? value.arrivalDate
    ?? value.useDate
    ?? value.checkDate
    ?? value.transactionDate
    ?? '',
  )
  return {
    id: record.id,
    no: String(record.no ?? ''),
    name: materialName || meta.value.label,
    projectId,
    projectName: projectId
      ? projectStore.byId(projectId)?.name ?? projectId
      : props.kind === 'stock_check' ? '仓库级' : '',
    quantity,
    unit: String(value.unit ?? (props.kind === 'stock_check' ? '项' : '')),
    date,
    status: statusLabel(String(record.status ?? 'draft')),
    statusValue: String(record.status ?? 'draft'),
  }
}

const rows = computed(() => records.value.map(rowFrom))
const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (projectFilter.value.length && !projectFilter.value.includes(row.projectName))
      return false
    if (statusFilter.value.length && !statusFilter.value.includes(row.statusValue))
      return false
    if (!keyword)
      return true
    return [row.no, row.name, row.projectName, row.status]
      .some(value => value.toLowerCase().includes(keyword))
  })
})

const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))
const filterDefinitions = computed(() => [
  {
    key: 'project',
    label: '项目',
    value: projectFilter.value,
    options: deriveFilterOptions(rows.value, 'projectName')
      .map(option => ({ label: option.label, key: String(option.value) })),
  },
  {
    key: 'status',
    label: '状态',
    value: statusFilter.value,
    options: deriveFilterOptions(rows.value, 'statusValue')
      .map(option => ({ label: statusLabel(String(option.value)), key: String(option.value) })),
  },
])

watch([search, projectFilter, statusFilter, pageSize], () => {
  page.value = 1
})

function onFilterChange(key: string, value: ColumnFilterValue) {
  if (!Array.isArray(value))
    return
  if (key === 'project')
    projectFilter.value = value
  else if (key === 'status')
    statusFilter.value = value
}

function clearFilters() {
  projectFilter.value = []
  statusFilter.value = []
  filtersOpen.value = false
}

function columnFilter(field?: string) {
  return filterDefinitions.value.find(filter => filter.key === (field === 'projectName' ? 'project' : field))
}

function onPageChange(event: { page: number, pageSize: number }) {
  page.value = event.page
  pageSize.value = event.pageSize
}

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: '材料/对象', minWidth: 220, fixed: 'left', slot: 'name' },
  { field: 'no', title: '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 170, customHeader: true },
  { field: 'quantity', title: '数量', width: 130, align: 'right', slot: 'quantity' },
  { field: 'date', title: '日期', type: 'date', width: 128 },
  { field: 'status', title: '状态', width: 110, slot: 'status', customHeader: true },
  { title: '操作', type: 'action', width: 104 },
]

async function load() {
  await Promise.all([
    materialStore.loadKind(props.kind),
    projectStore.load(),
  ])
}

function openCreate() {
  void navigateTo(materialFormPath(props.kind))
}

function openEdit(row: MaterialListRow) {
  void navigateTo(materialFormPath(props.kind, row.id))
}

async function handleDelete(row: MaterialListRow) {
  const accepted = await confirm({
    variant: 'simple',
    title: `删除${meta.value.label}`,
    message: `确认删除「${row.no || row.name}」？已生效事实删除后，相关库存和累计量会立即重新派生。`,
    confirmLabel: '删除',
  })
  if (!accepted)
    return
  try {
    const logId = await materialStore.removeForm(props.kind, row.id)
    if (!logId) {
      error('记录不存在或已删除')
      return
    }
    undoToast(`已删除「${row.no || row.name}」`, async () => {
      await materialStore.restoreForm(props.kind, row.id)
    })
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : '删除失败')
  }
}

onMounted(() => {
  void load()
})
onActivated(() => {
  void load()
})
</script>

<template>
  <ListShell continuous class="document-reference-list">
    <template #toolbar>
      <div class="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="单据列表工具栏">
        <h1 class="mr-auto truncate text-12px font-500 text-ink">
          {{ meta.label }}
        </h1>
        <SearchInput v-model="search" placeholder="搜索…" :width="210" class="document-list-search" />
        <button type="button" class="list-tool-button" title="刷新" aria-label="刷新" :disabled="materialStore.loading" @click="load">
          <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="materialStore.loading ? 'animate-spin' : ''" aria-hidden="true" />
        </button>
        <KitToolbarPopover v-model:open="filtersOpen" label="列表筛选" icon="i-lucide-filter" :active="hasFilters">
          <div class="grid gap-3">
            <div v-for="filter in filterDefinitions" :key="filter.key" class="grid gap-1">
              <span>{{ filter.label }}</span>
              <KitEnumFilterOptions :model-value="filter.value" :label="filter.label" :options="filter.options" @update:model-value="onFilterChange(filter.key, $event)" />
            </div>
            <button type="button" class="btn-secondary h-7 text-12px" @click="clearFilters">
              清除筛选
            </button>
          </div>
        </KitToolbarPopover>
        <button type="button" class="btn-primary h-7 px-3 text-12px" data-testid="create-material-form" :aria-label="`新建${meta.label}`" @click="openCreate">
          新建
        </button>
      </div>
    </template>

    <template #table>
      <KitTable
        :columns="columns"
        :data="pageRows"
        :loading="materialStore.loading && materialStore.records[kind] === undefined"
        :aria-busy="materialStore.loading"
        :row-height="32"
        :page="{ page: currentPage, pageSize, total: filtered.length }"
        @page-change="onPageChange"
      >
        <template #columnHeader="{ column }">
          <KitColumnHeader :title="column.title" kind="multi-enum" :value="columnFilter(column.field)?.value" :options="columnFilter(column.field)?.options" @apply="onFilterChange(column.field === 'projectName' ? 'project' : 'status', $event)" />
        </template>
        <template #name="{ row }">
          <button class="cell--link border-0 bg-transparent p-0 text-left" @click="openEdit(row)">
            {{ row.name }}
          </button>
        </template>
        <template #quantity="{ row }">
          <span class="font-mono font-700">{{ Number(row.quantity).toLocaleString('zh-CN') }} {{ row.unit }}</span>
        </template>
        <template #status="{ row }">
          <KitStatusTag :tone="statusTones[row.statusValue] ?? 'neutral'">
            {{ row.status }}
          </KitStatusTag>
        </template>
        <template #action="{ row }">
          <div class="flex items-center gap-1">
            <button class="icon-btn" title="查看/编辑" @click="openEdit(row)">
              <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
            </button>
            <button class="icon-btn-danger" title="删除" @click="handleDelete(row)">
              <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
            </button>
          </div>
        </template>
      </KitTable>
    </template>
    <template #summary>
      <span class="ml-auto">
        当前页 {{ pageRows.length }} 条 · 筛选后数量合计
        <strong class="ml-1 font-mono text-ink">
          {{ filtered.reduce((total, row) => total + row.quantity, 0).toLocaleString('zh-CN') }}
        </strong>
      </span>
    </template>
  </ListShell>
</template>

<style scoped>
.document-reference-list { border: 0; border-radius: 0; }
.document-reference-list :deep([data-list-shell-toolbar]) { padding: 10px 10px 6px; }
.document-reference-list :deep(.document-list-search) { flex: 1 1 100px; max-width: 210px; }
.document-reference-list :deep(.document-list-search input) { height: 28px; font-size: 12px; border-radius: 2px; }
.document-reference-list :deep(.vxe-body--column) { border-right-color: transparent; font-size: 12px; }
.document-reference-list :deep(.vxe-header--column) { font-size: 12px; font-weight: 600; }
.document-reference-list :deep(.cell--link) { text-decoration: none; }
.document-reference-list :deep(.cell--link:hover) { text-decoration: underline; }
</style>
