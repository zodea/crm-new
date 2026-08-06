<script setup lang="ts">
import type { ListFilterDefinition } from '~/components/shared/ListFilterBar.vue'
import type { F3FormKind } from '~/lib/finance/forms'
import type { KitTableColumn } from '~/lib/kit/table'
import type { FinanceListRow } from '~/stores/finance'
import { F3_FORM_META, financeFormPath } from '~/lib/finance/page'
import { financeStatusLabel } from '~/lib/finance/status'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'
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
const projectFilter = shallowRef('')
const partyFilter = shallowRef('')
const statusFilter = shallowRef('')
const page = shallowRef(1)
const pageSize = shallowRef(10)

const displayRows = computed(() => rows.value.map(row => ({
  ...row,
  statusLabel: financeStatusLabel(row.status),
})))

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return displayRows.value.filter((row) => {
    if (projectFilter.value && row.projectName !== projectFilter.value)
      return false
    if (partyFilter.value && row.partyName !== partyFilter.value)
      return false
    if (statusFilter.value && row.statusLabel !== statusFilter.value)
      return false
    if (!keyword)
      return true
    return [row.no, row.name, row.projectName, row.partyName, row.statusLabel]
      .some(value => value.toLowerCase().includes(keyword))
  })
})

const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const filterDefinitions = computed<ListFilterDefinition[]>(() => [
  {
    key: 'project',
    label: '项目',
    value: projectFilter.value,
    options: deriveFilterOptions(displayRows.value, 'projectName')
      .map(option => ({ label: option.label, value: String(option.value) })),
  },
  {
    key: 'party',
    label: '关联方',
    value: partyFilter.value,
    options: deriveFilterOptions(displayRows.value, 'partyName')
      .map(option => ({ label: option.label, value: String(option.value) })),
  },
  {
    key: 'status',
    label: '状态',
    value: statusFilter.value,
    options: deriveFilterOptions(displayRows.value, 'statusLabel')
      .map(option => ({ label: option.label, value: String(option.value) })),
  },
])

watch([search, projectFilter, partyFilter, statusFilter, pageSize], () => {
  page.value = 1
})

function onFilterChange(key: string, value: string) {
  if (key === 'project')
    projectFilter.value = value
  else if (key === 'party')
    partyFilter.value = value
  else if (key === 'status')
    statusFilter.value = value
}

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54 },
  { field: 'name', title: '名称/对象', minWidth: 220, fixed: 'left', slot: 'name' },
  { field: 'no', title: '编号', width: 170 },
  { field: 'projectName', title: '项目', minWidth: 160 },
  { field: 'partyName', title: '关联方/类型', minWidth: 180 },
  { field: 'amount', title: '金额', type: 'money', width: 140 },
  { field: 'date', title: '日期', type: 'date', width: 128 },
  { field: 'statusLabel', title: '状态', width: 110, slot: 'status' },
  { title: '操作', type: 'action', width: 72 },
]

async function load() {
  await financeStore.loadList(props.kind)
}

function openCreate() {
  void navigateTo(financeFormPath(props.kind))
}

function openEdit(row: FinanceListRow) {
  void navigateTo(financeFormPath(props.kind, row.id))
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
        <KitButton variant="secondary" :loading="loading" @click="load">
          <span class="i-lucide-refresh-cw mr-1" aria-hidden="true" />刷新
        </KitButton>
        <KitButton data-testid="create-finance-form" @click="openCreate">
          <span class="i-lucide-plus mr-1" aria-hidden="true" />新建{{ meta.label }}
        </KitButton>
      </div>
    </header>

    <ListFilterBar
      v-model:query="search"
      v-model:page="page"
      v-model:page-size="pageSize"
      :filters="filterDefinitions"
      :total="rows.length"
      :filtered="filtered.length"
      :page-count="pageCount"
      @filter-change="onFilterChange"
    />

    <div class="panel overflow-hidden">
      <KitTable :columns="columns" :data="pageRows" :loading="loading">
        <template #name="{ row }">
          <button class="cell--link border-0 bg-transparent p-0 text-left" @click="openEdit(row)">
            {{ row.name || '未命名记录' }}
          </button>
        </template>
        <template #status="{ row }">
          <span class="chip" :class="['已确认', '已审批', '已支付'].includes(row.statusLabel) ? 'chip-ok' : 'chip-brand'">
            {{ row.statusLabel }}
          </span>
        </template>
        <template #action="{ row }">
          <button class="icon-btn" title="编辑" @click="openEdit(row)">
            <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
          </button>
        </template>
      </KitTable>
      <div class="border-t border-line bg-surface-2 px-4 py-2 text-right text-12px text-ink-soft">
        当前页 {{ pageRows.length }} 条 · 筛选后金额合计
        <strong class="ml-1 font-mono text-ink">
          {{ yuan(filtered.reduce((total, row) => total + row.amount, 0)) }}
        </strong>
      </div>
    </div>
  </div>
</template>
