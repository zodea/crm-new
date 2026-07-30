<script setup lang="ts">
import type { RowActionItem } from '~/components/ui/RowActionMenu.vue'
import type { OwnerDocumentKind, OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import { clampPage, paginate } from '~/lib/kit/table'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import {
  filterOwnerDocumentRows,
  OWNER_DOCUMENT_LIST_CONFIG,
  ownerDocumentStatusClass,
  ownerDocumentStatusLabelForList,
  ownerDocumentStatusViewKey,
  ownerDocumentTypeLabel,
} from '~/lib/owner-document/list'
import {
  OWNER_DOCUMENT_META,
  ownerDocumentFormPath,
} from '~/lib/owner-document/page'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  kind: OwnerDocumentKind
}>()

const route = useRoute()
const store = useOwnerDocumentStore()
const { confirm, undoToast, error } = useKitUI()

const meta = computed(() => OWNER_DOCUMENT_META[props.kind])
const config = computed(() => OWNER_DOCUMENT_LIST_CONFIG[props.kind])
const rows = computed(() => store.recordsFor(props.kind))
const loading = computed(() => store.listLoadingFor(props.kind))
const loadError = computed(() => store.listError(props.kind))

const search = shallowRef('')
const projectFilter = shallowRef('all')
const typeFilter = shallowRef('all')
const statusView = shallowRef(config.value.defaultView)
const page = shallowRef(1)
const pageSize = shallowRef(10)

function queryText(key: 'project' | 'contract' | 'supplier'): string {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

const routeProject = computed(() => queryText('project'))
const routeContract = computed(() => queryText('contract'))
const routeSupplier = computed(() => queryText('supplier'))

const filtered = computed(() => filterOwnerDocumentRows(props.kind, rows.value, {
  search: search.value,
  project: projectFilter.value,
  type: typeFilter.value,
  statusView: statusView.value,
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

interface FilterOption {
  key: string
  label: string
}

function distinctOptions(
  key: 'projectId' | 'type',
  label: (row: OwnerDocumentListRecord) => string,
  allLabel: string,
): FilterOption[] {
  const values = rows.value
    .map(row => ({ key: row[key] ?? '', label: label(row) }))
    .filter(option => option.key && option.label)
  return [
    { key: 'all', label: allLabel },
    ...[...new Map(values.map(option => [option.key, option])).values()]
      .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN')),
  ]
}

const projectOptions = computed(() =>
  distinctOptions('projectId', row => row.projectName, '全部项目'),
)
const typeOptions = computed(() =>
  distinctOptions(
    'type',
    row => ownerDocumentTypeLabel(props.kind, row.type),
    `全部${config.value.typeLabel}`,
  ),
)
const statusOptions = computed(() =>
  config.value.views.map(view => ({
    ...view,
    count: rows.value.filter(row =>
      view.key === 'all'
      || ownerDocumentStatusViewKey(props.kind, row.status) === view.key,
    ).length,
  })),
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
  || projectFilter.value !== 'all'
  || typeFilter.value !== 'all'
  || statusView.value !== config.value.defaultView,
)
const emptyState = computed(() => {
  if (rows.value.length === 0) {
    return {
      title: `暂无${meta.value.label}`,
      description: `当前业务范围内还没有${meta.value.label}，可从新建开始。`,
      actionLabel: `新建${meta.value.label}`,
    }
  }
  return {
    title: `没有符合条件的${meta.value.label}`,
    description: '请调整搜索、项目、类型或状态筛选条件。',
    actionLabel: '清除筛选',
  }
})
const summaries = computed(() =>
  config.value.amountSummaries.map(summary => ({
    label: summary.label,
    value: filtered.value.reduce(
      (total, row) => total + Number(row[summary.field] || 0),
      0,
    ),
  })),
)
const tableMinWidth = computed(() =>
  config.value.columns.reduce(
    (total, column) => total + (column.width ?? column.minWidth ?? 120),
    0,
  ),
)

function rowActions(row: OwnerDocumentListRecord): RowActionItem[] {
  const canDelete = ownerDocumentStatusIsEditable(row.status)
  return [
    { key: 'edit', label: '查看/编辑', icon: 'i-lucide-square-pen' },
    {
      key: 'delete',
      label: canDelete ? '删除' : '当前状态不可删除',
      icon: 'i-lucide-trash-2',
      tone: 'danger',
      disabled: !canDelete,
    },
  ]
}

async function load() {
  try {
    await store.loadKind(props.kind)
  }
  catch {
    // Store 持有当前类型的可重试错误态，避免生命周期出现未处理拒绝。
  }
}

function openCreate() {
  void navigateTo(ownerDocumentFormPath(props.kind))
}

function openEdit(row: OwnerDocumentListRecord) {
  void navigateTo(ownerDocumentFormPath(props.kind, row.id))
}

async function clearRouteFilter(key: 'project' | 'contract' | 'supplier') {
  const query = { ...route.query }
  delete query[key]
  await navigateTo({ path: route.path, query }, { replace: true })
}

async function resetFilters() {
  search.value = ''
  projectFilter.value = 'all'
  typeFilter.value = 'all'
  statusView.value = config.value.defaultView
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

async function handleRowAction(action: string, row: OwnerDocumentListRecord) {
  if (action === 'edit') {
    openEdit(row)
    return
  }
  if (action === 'delete')
    await handleDelete(row)
}

function restoreRowActionFocus(row: OwnerDocumentListRecord) {
  window.setTimeout(() => {
    const label = `${row.no || row.name}${meta.value.label}操作`
    const trigger = [...document.querySelectorAll<HTMLElement>('[data-ui="row-action-menu-trigger"]')]
      .find(element =>
        element.getAttribute('aria-label') === label
        && element.offsetParent !== null,
      )
    trigger?.focus()
  })
}

async function handleDelete(row: OwnerDocumentListRecord) {
  const accepted = await confirm({
    variant: 'simple',
    title: `删除${meta.value.label}`,
    message: `确认删除「${row.no || row.name}」？关联明细将随父单据一并隐藏。`,
    confirmLabel: '删除',
  })
  if (!accepted) {
    restoreRowActionFocus(row)
    return
  }
  try {
    const logId = await store.removeForm(props.kind, row.id)
    if (!logId) {
      error('记录不存在或已删除')
      return
    }
    undoToast(`已删除「${row.no || row.name}」`, async () => {
      await store.restoreForm(props.kind, row.id)
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
  [search, projectFilter, typeFilter, statusView, routeProject, routeContract, routeSupplier],
  () => page.value = 1,
)
watch(
  () => props.kind,
  () => {
    search.value = ''
    projectFilter.value = 'all'
    typeFilter.value = 'all'
    statusView.value = config.value.defaultView
    void load()
  },
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
    <OwnerDocumentListToolbar
      v-model:search="search"
      v-model:project="projectFilter"
      v-model:type="typeFilter"
      v-model:view="statusView"
      :title="meta.label"
      :subtitle="meta.subtitle"
      :create-label="`新建${meta.label}`"
      :loading="loading"
      :search-placeholder="config.searchPlaceholder"
      :show-type="config.showTypeFilter"
      :type-label="config.typeLabel"
      :project-options="projectOptions"
      :type-options="typeOptions"
      :views="statusOptions"
      @refresh="load"
      @create="openCreate"
    />

    <div
      v-if="contextFilters.length"
      data-ui="owner-document-route-context"
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
      :title="`${meta.label}载入失败`"
      :description="loadError"
      action-label="重新载入"
      @action="load"
    />

    <div v-else class="min-w-0">
      <div
        data-ui="owner-document-table"
        role="region"
        :aria-label="`${meta.label}列表，可横向滚动查看完整列`"
        tabindex="0"
        class="max-w-full overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
      >
        <KitTable
          :columns="config.columns"
          :data="pageRows"
          :loading="loading"
          :page="{ page: currentPage, pageSize, total: filtered.length }"
          :empty="emptyState"
          :style="{ minWidth: `${tableMinWidth}px`, maxWidth: 'none' }"
          @page-change="handlePageChange"
          @empty-action="handleEmptyAction"
        >
          <template #document="{ row }">
            <NuxtLink
              :to="ownerDocumentFormPath(kind, row.id)"
              class="cell--link whitespace-nowrap font-mono"
              :title="row.no || row.name"
            >
              {{ row.no || '未编号' }}
            </NuxtLink>
          </template>
          <template #project="{ row }">
            <EntityLink :id="row.projectId" type="project" :label="row.projectName" />
          </template>
          <template #contract="{ row }">
            <EntityLink :id="row.contractId" type="contract" :label="row.contractName" />
          </template>
          <template #supplier="{ row }">
            <EntityLink
              :id="row.supplierId"
              type="supplier"
              :label="row.supplierName || row.crewName"
            />
          </template>
          <template #type="{ row }">
            {{ ownerDocumentTypeLabel(kind, row.type) || '—' }}
          </template>
          <template #negativeAmount="{ row }">
            <span class="whitespace-nowrap font-mono font-700 text-danger">
              -{{ yuan(row.amount) }}
            </span>
          </template>
          <template #status="{ row }">
            <span class="chip" :class="ownerDocumentStatusClass(kind, row.status)">
              {{ ownerDocumentStatusLabelForList(kind, row.status) }}
            </span>
          </template>
          <template #action="{ row }">
            <RowActionMenu
              :items="rowActions(row)"
              :label="`${row.no || row.name}${meta.label}操作`"
              @select="handleRowAction($event, row)"
            />
          </template>
        </KitTable>
      </div>

      <div
        data-ui="owner-document-summary"
        class="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 border-x border-b border-line bg-surface-2 px-4 py-2 text-12px text-ink-soft"
        role="status"
        :aria-label="`${meta.label}列表汇总`"
      >
        <span>{{ config.countLabel }}：<strong class="text-ink">{{ filtered.length }}</strong></span>
        <span v-for="summary in summaries" :key="summary.label">
          {{ summary.label }}：
          <strong class="whitespace-nowrap font-mono text-ink">{{ yuan(summary.value) }}</strong>
        </span>
        <button
          v-if="filtered.length > 0 && (hasLocalFilters || contextFilters.length)"
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
