<script setup lang="ts">
import type { ListFilterDefinition } from '~/components/shared/ListFilterBar.vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type {
  MaterialFormKind,
  MaterialFormRecordMap,
} from '~/lib/material/forms'
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
}

const props = defineProps<{
  kind: MaterialFormKind
}>()

const materialStore = useMaterialStore()
const projectStore = useProjectStore()
const { confirm, undoToast, error } = useKitUI()
const meta = computed(() => MATERIAL_FORM_META[props.kind])
const search = shallowRef('')
const projectFilter = shallowRef('')
const statusFilter = shallowRef('')
const page = shallowRef(1)
const pageSize = shallowRef(10)

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
  }
}

const rows = computed(() => records.value.map(rowFrom))
const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return rows.value.filter((row) => {
    if (projectFilter.value && row.projectName !== projectFilter.value)
      return false
    if (statusFilter.value && row.status !== statusFilter.value)
      return false
    if (!keyword)
      return true
    return [row.no, row.name, row.projectName, row.status]
      .some(value => value.toLowerCase().includes(keyword))
  })
})

const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))
const filterDefinitions = computed<ListFilterDefinition[]>(() => [
  {
    key: 'project',
    label: '项目',
    value: projectFilter.value,
    options: deriveFilterOptions(rows.value, 'projectName')
      .map(option => ({ label: option.label, value: String(option.value) })),
  },
  {
    key: 'status',
    label: '状态',
    value: statusFilter.value,
    options: deriveFilterOptions(rows.value, 'status')
      .map(option => ({ label: option.label, value: String(option.value) })),
  },
])

watch([search, projectFilter, statusFilter, pageSize], () => {
  page.value = 1
})

function onFilterChange(key: string, value: string) {
  if (key === 'project')
    projectFilter.value = value
  else if (key === 'status')
    statusFilter.value = value
}

function onPageChange(event: { page: number, pageSize: number }) {
  page.value = event.page
  pageSize.value = event.pageSize
}

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: '材料/对象', minWidth: 220, fixed: 'left', slot: 'name' },
  { field: 'no', title: '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 170 },
  { field: 'quantity', title: '数量', width: 130, align: 'right', slot: 'quantity' },
  { field: 'date', title: '日期', type: 'date', width: 128 },
  { field: 'status', title: '状态', width: 110, slot: 'status' },
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
  <div class="flex min-w-0 flex-col gap-4">
    <header class="panel flex flex-wrap items-center gap-3 px-4 py-3">
      <div>
        <h1 class="text-17px font-800 text-ink">
          {{ meta.label }}
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          {{ meta.subtitle }}
        </p>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <KitButton variant="secondary" :loading="materialStore.loading" @click="load">
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />刷新
        </KitButton>
        <KitButton data-testid="create-material-form" @click="openCreate">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新建{{ meta.label }}
        </KitButton>
      </div>
    </header>

    <ListFilterBar
      v-model:query="search"
      :filters="filterDefinitions"
      :total="rows.length"
      :filtered="filtered.length"
      @filter-change="onFilterChange"
    />

    <div class="panel overflow-hidden">
      <KitTable
        :columns="columns"
        :data="pageRows"
        :loading="materialStore.loading"
        :page="{ page: currentPage, pageSize, total: filtered.length }"
        @page-change="onPageChange"
      >
        <template #name="{ row }">
          <button class="cell--link border-0 bg-transparent p-0 text-left" @click="openEdit(row)">
            {{ row.name }}
          </button>
        </template>
        <template #quantity="{ row }">
          <span class="font-mono font-700">{{ Number(row.quantity).toLocaleString('zh-CN') }} {{ row.unit }}</span>
        </template>
        <template #status="{ row }">
          <span class="chip" :class="row.status === '草稿' ? 'chip-brand' : 'chip-ok'">
            {{ row.status }}
          </span>
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
      <div class="border-t border-line bg-surface-2 px-4 py-2 text-right text-12px text-ink-soft">
        当前页 {{ pageRows.length }} 条 · 筛选后数量合计
        <strong class="ml-1 font-mono text-ink">
          {{ filtered.reduce((total, row) => total + row.quantity, 0).toLocaleString('zh-CN') }}
        </strong>
      </div>
    </div>
  </div>
</template>
