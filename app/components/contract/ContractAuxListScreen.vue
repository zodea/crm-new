<script setup lang="ts">
import type {
  ContractAuxListKind,
  ContractAuxRow,
} from '~/lib/contract/aux-list'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import {
  CONTRACT_AUX_LIST_CONFIG,
  contractAuxStatusTone,
  filterContractAuxRows,
} from '~/lib/contract/aux-list'
import { F2_FORM_META, formPath } from '~/lib/contract/page'
import { clampPage, paginate } from '~/lib/kit/table'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  kind: ContractAuxListKind
}>()

const route = useRoute()
const contractStore = useContractStore()
const { confirm, undoToast, error } = useKitUI()

const meta = computed(() => F2_FORM_META[props.kind])
const config = computed(() => CONTRACT_AUX_LIST_CONFIG[props.kind])
const rows = computed(() => contractStore.auxByKind(props.kind))
const loading = computed(() => contractStore.auxLoadingFor(props.kind))
const loadError = computed(() => contractStore.auxError(props.kind))

const search = shallowRef('')
const projectFilter = shallowRef<string[]>([])
const categoryFilter = shallowRef<string[]>([])
const statusFilter = shallowRef<string[]>([])
const page = shallowRef(1)
const pageSize = shallowRef(10)

function queryText(key: 'project' | 'contract' | 'supplier'): string {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

const routeProject = computed(() =>
  props.kind === 'company_expense' ? '' : queryText('project'),
)
const routeContract = computed(() =>
  props.kind.endsWith('_settlement') ? queryText('contract') : '',
)
const routeSupplier = computed(() =>
  props.kind === 'company_expense' ? '' : queryText('supplier'),
)

const filtered = computed(() => filterContractAuxRows(props.kind, rows.value, {
  search: search.value,
  project: projectFilter.value,
  category: categoryFilter.value,
  status: statusFilter.value,
  routeProject: routeProject.value,
  routeContract: routeContract.value,
  routeSupplier: routeSupplier.value,
}))

const currentPage = computed(() =>
  clampPage(page.value, filtered.value.length, pageSize.value),
)
const pageRows = computed(() =>
  paginate(filtered.value, currentPage.value, pageSize.value),
)
const summaryAmount = computed(() =>
  filtered.value.reduce((total, row) => total + Number(row.amount || 0), 0),
)

interface FilterOption {
  key: string
  label: string
}

function distinctOptions(
  key: 'projectId' | 'category' | 'status',
  labelKey: 'projectName' | 'category' | 'status',
  allLabel: string,
): FilterOption[] {
  const values = rows.value
    .map(row => ({ key: row[key], label: row[labelKey] }))
    .filter(option => option.key && option.label)
  return [
    { key: 'all', label: allLabel },
    ...[...new Map(values.map(option => [option.key, option])).values()]
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
  ]
}

const projectOptions = computed(() =>
  distinctOptions('projectId', 'projectName', '全部项目'),
)
const categoryOptions = computed(() =>
  distinctOptions('category', 'category', '全部类别'),
)
const statusOptions = computed(() =>
  distinctOptions('status', 'status', '全部状态'),
)

const contextFilters = computed(() => {
  const contexts: Array<{ key: 'project' | 'contract' | 'supplier', label: string }> = []
  if (routeProject.value) {
    const label = rows.value.find(row => row.projectId === routeProject.value)?.projectName
      || routeProject.value
    contexts.push({ key: 'project', label: `项目：${label}` })
  }
  if (routeContract.value) {
    const label = rows.value.find(row => row.contractId === routeContract.value)?.contractName
      || routeContract.value
    contexts.push({ key: 'contract', label: `合同：${label}` })
  }
  if (routeSupplier.value) {
    const label = rows.value.find(row => row.supplierId === routeSupplier.value)?.supplierName
      || routeSupplier.value
    contexts.push({ key: 'supplier', label: `分供方：${label}` })
  }
  return contexts
})

const hasLocalFilters = computed(() =>
  Boolean(search.value)
  || projectFilter.value.length > 0
  || categoryFilter.value.length > 0
  || statusFilter.value.length > 0,
)

const emptyState = computed(() => {
  if (rows.value.length === 0) {
    return {
      title: `暂无${meta.value.listLabel}`,
      description: `当前业务范围内还没有${meta.value.label}，可从新建开始。`,
      actionLabel: `新建${meta.value.label}`,
    }
  }
  return {
    title: `没有符合条件的${meta.value.label}`,
    description: '请调整搜索、项目、类别或状态筛选条件。',
    actionLabel: '清除筛选',
  }
})

const rowActions = [
  { key: 'edit', label: '编辑', icon: 'i-lucide-square-pen' },
  { key: 'delete', label: '删除', icon: 'i-lucide-trash-2', tone: 'danger' as const },
] as const

async function load() {
  try {
    await contractStore.loadAux(props.kind)
  }
  catch {
    // Store 持有可重试错误态；此处避免挂载生命周期产生未处理拒绝。
  }
}

function openCreate() {
  void navigateTo(formPath(props.kind))
}

function openEdit(row: ContractAuxRow) {
  void navigateTo(formPath(props.kind, row.id))
}

function sourceContractPath(row: ContractAuxRow): string {
  return props.kind === 'material_settlement'
    ? formPath('material', row.contractId)
    : formPath('other_expense', row.contractId)
}

async function clearRouteFilter(key: 'project' | 'contract' | 'supplier') {
  const query = { ...route.query }
  delete query[key]
  await navigateTo({ path: route.path, query }, { replace: true })
}

async function resetFilters() {
  search.value = ''
  projectFilter.value = []
  categoryFilter.value = []
  statusFilter.value = []
  if (contextFilters.value.length) {
    const query = { ...route.query }
    delete query.project
    delete query.contract
    delete query.supplier
    await navigateTo({ path: route.path, query }, { replace: true })
  }
}

function handleEmptyAction() {
  if (rows.value.length === 0)
    openCreate()
  else
    void resetFilters()
}

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

async function handleRowAction(action: string, row: ContractAuxRow) {
  if (action === 'edit') {
    openEdit(row)
    return
  }
  if (action === 'delete')
    await handleDelete(row)
}

function restoreRowActionFocus(row: ContractAuxRow) {
  window.setTimeout(() => {
    const label = `${row.name}${meta.value.label}操作`
    const trigger = [...document.querySelectorAll<HTMLElement>('[data-ui="row-action-menu-trigger"]')]
      .find(element =>
        element.getAttribute('aria-label') === label
        && element.offsetParent !== null,
      )
    trigger?.focus()
  })
}

async function handleDelete(row: ContractAuxRow) {
  const accepted = await confirm({
    variant: 'simple',
    title: `删除${meta.value.label}`,
    message: `确认删除「${row.name}」？有关联付款分摊或下游单据时会阻止删除。`,
    confirmLabel: '删除',
  })
  if (!accepted) {
    restoreRowActionFocus(row)
    return
  }
  try {
    const logId = await contractStore.removeForm(props.kind, row.id)
    if (!logId) {
      error('记录不存在或已删除')
      return
    }
    undoToast(`已删除「${row.name}」`, async () => {
      await contractStore.undoForm(props.kind, logId)
    })
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : '删除失败')
  }
  finally {
    restoreRowActionFocus(row)
  }
}

watch(
  [search, projectFilter, categoryFilter, statusFilter, routeProject, routeContract, routeSupplier],
  () => page.value = 1,
)

let hasActivated = false
onMounted(() => void load())
onActivated(() => {
  if (!hasActivated) {
    hasActivated = true
    return
  }
  void load()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <ContractAuxListToolbar
      v-model:search="search"
      v-model:project="projectFilter"
      v-model:category="categoryFilter"
      v-model:status="statusFilter"
      :title="meta.listLabel"
      :subtitle="meta.subtitle"
      :create-label="`新建${meta.label}`"
      :loading="loading"
      :search-placeholder="config.searchPlaceholder"
      :show-project="config.showProjectFilter"
      :show-category="config.showCategoryFilter"
      :project-options="projectOptions"
      :category-options="categoryOptions"
      :status-options="statusOptions"
      @refresh="load"
      @create="openCreate"
    />

    <div
      v-if="contextFilters.length"
      data-ui="contract-aux-route-context"
      class="flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-brand/25 bg-brand-soft px-3 py-2"
      aria-label="来源筛选"
    >
      <span class="text-11px font-700 text-brand-deep">来源范围</span>
      <button
        v-for="context in contextFilters"
        :key="context.key"
        type="button"
        class="chip chip-brand gap-1 border-0 cursor-pointer"
        :aria-label="`清除${context.label}筛选`"
        @click="clearRouteFilter(context.key)"
      >
        {{ context.label }}
        <span class="i-lucide-x h-3 w-3" aria-hidden="true" />
      </button>
    </div>

    <StatePanel
      v-if="loadError && !loading"
      kind="error"
      :title="`${meta.listLabel}载入失败`"
      :description="loadError"
      action-label="重新载入"
      @action="load"
    />

    <div v-else class="min-w-0">
      <KitTable
        data-ui="contract-aux-table"
        :columns="config.columns"
        :data="pageRows"
        :loading="loading"
        :page="{ page: currentPage, pageSize, total: filtered.length }"
        :empty="emptyState"
        @page-change="handlePageChange"
        @empty-action="handleEmptyAction"
      >
        <template #name="{ row }">
          <NuxtLink :to="formPath(kind, row.id)" class="cell--link" :title="row.name">
            {{ row.name }}
          </NuxtLink>
        </template>
        <template #project="{ row }">
          <NuxtLink v-if="row.projectId" :to="`/project/${row.projectId}`" class="cell--link">
            {{ row.projectName || '—' }}
          </NuxtLink>
          <span v-else>—</span>
        </template>
        <template #supplier="{ row }">
          <NuxtLink v-if="row.supplierId" :to="`/base/supplier/${row.supplierId}`" class="cell--link">
            {{ row.supplierName || '—' }}
          </NuxtLink>
          <span v-else>—</span>
        </template>
        <template #contract="{ row }">
          <NuxtLink v-if="row.contractId" :to="sourceContractPath(row)" class="cell--link">
            {{ row.contractName || '—' }}
          </NuxtLink>
          <span v-else>—</span>
        </template>
        <template #status="{ row }">
          <KitStatusTag :tone="contractAuxStatusTone(row.status)">
            {{ row.status }}
          </KitStatusTag>
        </template>
        <template #action="{ row }">
          <RowActionMenu
            :items="rowActions"
            :label="`${row.name}${meta.label}操作`"
            @select="handleRowAction($event, row)"
          />
        </template>
      </KitTable>

      <div
        data-ui="contract-aux-summary"
        class="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 border-x border-b border-line bg-surface-2 px-4 py-2 text-12px text-ink-soft"
      >
        <span>{{ config.countLabel }}：<strong class="text-ink">{{ filtered.length }}</strong></span>
        <span>
          {{ config.amountLabel }}：
          <strong class="font-mono text-ink">{{ yuan(summaryAmount) }}</strong>
        </span>
        <button
          v-if="hasLocalFilters || contextFilters.length"
          type="button"
          class="border-0 bg-transparent p-0 text-12px font-700 text-brand-deep"
          @click="resetFilters"
        >
          清除筛选
        </button>
      </div>
    </div>
  </div>
</template>
