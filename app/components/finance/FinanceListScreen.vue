<script setup lang="ts">
import type { ColumnFilterValue } from '~/components/ui/KitColumnHeader.vue'
import type { F3FormKind } from '~/lib/finance/forms'
import type { KitTableColumn } from '~/lib/kit/table'
import type { FinanceListRow } from '~/stores/finance'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'
import KitEnumFilterOptions from '~/components/ui/KitEnumFilterOptions.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import KitToolbarPopover from '~/components/ui/KitToolbarPopover.vue'
import ListShell from '~/components/ui/ListShell.vue'
import { F3_FORM_META, financeDetailPath, financeFormPath, receiptDetailPath } from '~/lib/finance/page'
import { verifiedFinanceSum } from '~/lib/finance/persistent-rows'
import { financeStatusLabel, financeStatusTone } from '~/lib/finance/status'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  kind: F3FormKind
}>()

const meta = computed(() => F3_FORM_META[props.kind])
const financeStore = useFinanceStore()
const { listRows, loading } = storeToRefs(financeStore)
const rows = computed<FinanceListRow[]>(() => [
  ...(listRows.value[props.kind] ?? []),
])
const search = shallowRef('')
const projectFilter = shallowRef<string[]>([])
const partyFilter = shallowRef<string[]>([])
const statusFilter = shallowRef<string[]>([])
const page = shallowRef(1)
const pageSize = shallowRef(10)
const filtersOpen = shallowRef(false)
const readError = shallowRef<string | null>(null)
let readGeneration = 0
bindReadAuthority((problem) => {
  ++readGeneration
  readError.value = problem.message
})
const hasFilters = computed(() => projectFilter.value.length > 0 || partyFilter.value.length > 0 || statusFilter.value.length > 0)

const displayRows = computed(() => rows.value.map(row => ({
  ...row,
  statusLabel: financeStatusLabel(row.status),
})))

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return displayRows.value.filter((row) => {
    if (projectFilter.value.length && !projectFilter.value.includes(row.projectName))
      return false
    if (partyFilter.value.length && !partyFilter.value.includes(row.partyName))
      return false
    if (statusFilter.value.length && !statusFilter.value.includes(row.status))
      return false
    if (!keyword)
      return true
    return [row.no, row.name, row.projectName, row.partyName, row.statusLabel]
      .some(value => value.toLowerCase().includes(keyword))
  })
})

const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))
const amountSummary = computed(() => {
  if (listRows.value[props.kind] === undefined || readError.value)
    return null
  try {
    return verifiedFinanceSum(filtered.value.map(row => row.amount))
  }
  catch { return null }
})
const filterDefinitions = computed(() => [
  {
    key: 'project',
    label: '项目',
    value: projectFilter.value,
    options: deriveFilterOptions(displayRows.value, 'projectName')
      .map(option => ({ label: option.label, key: String(option.value) })),
  },
  {
    key: 'party',
    label: '关联方',
    value: partyFilter.value,
    options: deriveFilterOptions(displayRows.value, 'partyName')
      .map(option => ({ label: option.label, key: String(option.value) })),
  },
  {
    key: 'status',
    label: '状态',
    value: statusFilter.value,
    options: deriveFilterOptions(displayRows.value, 'status')
      .map(option => ({ label: financeStatusLabel(String(option.value)), key: String(option.value) })),
  },
])

const isReceipt = computed(() => props.kind === 'receipt')
const amountSummaryLabel = computed(() => isReceipt.value ? '筛选后收款合计' : '筛选后金额合计')

watch([search, projectFilter, partyFilter, statusFilter, pageSize], () => {
  page.value = 1
})

function onFilterChange(key: string, value: ColumnFilterValue) {
  if (!Array.isArray(value))
    return
  if (key === 'project')
    projectFilter.value = value
  else if (key === 'party')
    partyFilter.value = value
  else if (key === 'status')
    statusFilter.value = value
}

function clearFilters() {
  projectFilter.value = []
  partyFilter.value = []
  statusFilter.value = []
  filtersOpen.value = false
}

function columnFilter(field?: string) {
  const key = field === 'projectName' ? 'project' : field === 'partyName' ? 'party' : 'status'
  return filterDefinitions.value.find(filter => filter.key === key)
}

function onPageChange(event: { page: number, pageSize: number }) {
  page.value = event.page
  pageSize.value = event.pageSize
}

const columns = computed<KitTableColumn[]>(() => [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: isReceipt.value ? '付款方（甲方客户）' : '名称/对象', minWidth: 220, fixed: 'left', slot: 'name' },
  { field: 'no', title: isReceipt.value ? '收款编号' : '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 160, customHeader: true },
  { field: 'partyName', title: isReceipt.value ? '施工合同（可选）' : '关联方/类型', minWidth: 180, customHeader: true },
  ...(isReceipt.value ? [{ title: '收款方', field: 'receiptPayee', minWidth: 140, slot: 'receiptPayee' } satisfies KitTableColumn] : []),
  { field: 'amount', title: isReceipt.value ? '收款金额' : '金额', type: 'money', width: 140 },
  { field: 'date', title: isReceipt.value ? '收款日期' : '日期', type: 'date', width: 128 },
  { field: 'statusLabel', title: '状态', width: 110, slot: 'status', customHeader: true },
  { title: '操作', type: 'action', width: 72 },
])

async function load() {
  const generation = ++readGeneration
  readError.value = null
  try {
    await financeStore.loadList(props.kind)
  }
  catch (cause) {
    if (generation === readGeneration)
      readError.value = toErrorMessage(cause)
  }
}

function openCreate() {
  void navigateTo(financeFormPath(props.kind))
}

function openEdit(row: FinanceListRow) {
  void navigateTo(financeFormPath(props.kind, row.id))
}

function openDetail(row: FinanceListRow) {
  if (props.kind === 'receipt') {
    if (!row.dataOrigin || !row.customerId)
      return
    void navigateTo(receiptDetailPath(row.id, { origin: row.dataOrigin, customerId: row.customerId }))
    return
  }
  void navigateTo(financeDetailPath(props.kind, row.id))
}

function canOpenDetail(row: FinanceListRow) {
  return props.kind !== 'receipt' || Boolean(row.dataOrigin && row.customerId)
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
        <button type="button" class="list-tool-button" title="刷新" aria-label="刷新" :disabled="loading" @click="load">
          <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
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
        <button type="button" class="btn-primary h-7 px-3 text-12px" data-testid="create-finance-form" :aria-label="`新建${meta.label}`" @click="openCreate">
          新建
        </button>
      </div>
    </template>

    <template #table>
      <div v-if="listRows[kind] === undefined && !loading" class="p-3 text-12px" role="status" data-testid="finance-list-unavailable">
        <p class="text-ink-soft">
          {{ readError || '记录与金额尚未可靠读取，请重新读取。' }}
        </p>
        <button type="button" class="btn-secondary mt-2 h-7" @click="load">
          重新读取
        </button>
      </div>
      <KitTable
        v-else
        :columns="columns"
        :data="pageRows"
        :loading="loading && listRows[kind] === undefined"
        :aria-busy="loading"
        :row-height="32"
        :page="{ page: currentPage, pageSize, total: filtered.length }"
        @page-change="onPageChange"
      >
        <template #columnHeader="{ column }">
          <KitColumnHeader :title="column.title" kind="multi-enum" :value="columnFilter(column.field)?.value" :options="columnFilter(column.field)?.options" @apply="onFilterChange(columnFilter(column.field)?.key ?? '', $event)" />
        </template>
        <template #name="{ row }">
          <button v-if="canOpenDetail(row)" class="cell--link border-0 bg-transparent p-0 text-left" @click="openDetail(row)">
            {{ row.name || (isReceipt ? '待补充甲方客户' : '未命名记录') }}
          </button>
          <span v-else data-testid="non-central-receipt-name" class="text-ink">
            {{ row.name || '待补充甲方客户' }}
          </span>
        </template>
        <template #status="{ row }">
          <KitStatusTag :tone="financeStatusTone(row.status)">
            {{ row.statusLabel }}
          </KitStatusTag>
        </template>
        <template #receiptPayee>
          <span class="text-ink-soft">我方乙方</span>
        </template>
        <template #action="{ row }">
          <button class="icon-btn" title="编辑" @click="openEdit(row)">
            <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
          </button>
        </template>
      </KitTable>
    </template>
    <template #summary>
      <span v-if="amountSummary !== null" class="ml-auto">
        当前页 {{ pageRows.length }} 条 · {{ amountSummaryLabel }}
        <strong class="ml-1 font-mono text-ink">
          {{ yuan(amountSummary) }}
        </strong>
      </span>
      <span v-else class="ml-auto text-ink-soft" data-testid="finance-list-summary-unknown">金额合计尚未核实</span>
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
