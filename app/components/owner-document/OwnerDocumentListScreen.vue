<script setup lang="ts">
import type { RowActionItem } from '~/components/ui/RowActionMenu.vue'
import type { OwnerCommercialDocumentKind } from '~/lib/owner-document/central-repository'
import type { OwnerDocumentKind, OwnerDocumentListRecord } from '~/lib/owner-document/forms'
import OwnerDocumentListToolbar from '~/components/owner-document/OwnerDocumentListToolbar.vue'
import TargetCostSourceReturn from '~/components/target-cost/TargetCostSourceReturn.vue'
import { clampPage, paginate } from '~/lib/kit/table'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { ownerDocumentStatusIsEditable } from '~/lib/owner-document/forms'
import {
  filterOwnerDocumentRows,
  OWNER_ACCEPTANCE_LIST_COLUMNS,
  OWNER_ACCEPTANCE_LIST_VIEWS,
  OWNER_DOCUMENT_LIST_CONFIG,
  ownerDocumentStatusClass,
  ownerDocumentStatusLabelForList,
  ownerDocumentStatusViewKey,
  ownerDocumentTypeLabel,
} from '~/lib/owner-document/list'
import {
  OWNER_DOCUMENT_META,
  ownerDocumentDetailPath,
  ownerDocumentFormPath,
} from '~/lib/owner-document/page'
import {
  createOwnerDocumentReturnOrigin,
  isOwnerDocumentReturnContextId,
  loadOwnerDocumentReturnOrigin,
  newOwnerDocumentReturnContextId,
  ownerDocumentListNavigationStateFromQuery,
  saveOwnerDocumentReturnOrigin,
  validateOwnerDocumentJourneyReturnTo,
  validateOwnerDocumentListReturnTo,
} from '~/lib/owner-document/return-context'
import { enumSelectionFromQuery, serializeEnumSelection } from '~/lib/util/enum-selection'
import { yuan } from '~/lib/util/money'

const props = defineProps<{
  kind: OwnerDocumentKind
}>()

const route = useRoute()
const router = useRouter()
const listPath = route.path
const listRoot = shallowRef<HTMLElement | null>(null)
const store = useOwnerDocumentStore()
const { confirm, undoToast, error } = useKitUI()

const meta = computed(() => OWNER_DOCUMENT_META[props.kind])
const acceptanceVariant = computed(() => route.query.variant === 'warranty' ? 'warranty' : 'acceptance')
const config = computed(() => {
  const base = OWNER_DOCUMENT_LIST_CONFIG[props.kind]
  return props.kind === 'acceptance'
    ? {
        ...base,
        columns: OWNER_ACCEPTANCE_LIST_COLUMNS[acceptanceVariant.value],
        views: OWNER_ACCEPTANCE_LIST_VIEWS[acceptanceVariant.value],
      }
    : base
})
const loading = computed(() => store.listLoadingFor(props.kind))
const loadError = computed(() => store.listError(props.kind))
const centralReadOnly = computed(() => props.kind === 'owner_change' || props.kind === 'owner_report'
  || props.kind === 'acceptance' || props.kind === 'final_settlement' || props.kind === 'owner_penalty'
  || props.kind === 'sub_change' || props.kind === 'sub_settlement' || props.kind === 'project_penalty')
const centralKind = computed(() => props.kind as OwnerCommercialDocumentKind)
const hasSnapshot = computed(() => store.hasListSnapshot(props.kind, centralReadOnly.value && props.kind === 'acceptance' ? acceptanceVariant.value : null))
const rows = computed(() => hasSnapshot.value ? store.recordsFor(props.kind) : [])
const initialNavigation = ownerDocumentListNavigationStateFromQuery(route.query, centralKind.value)

const search = shallowRef(centralReadOnly.value ? initialNavigation.search : '')
const projectFilter = shallowRef(centralReadOnly.value ? initialNavigation.projectId ?? 'all' : 'all')
const typeFilter = shallowRef<string | string[]>(centralReadOnly.value ? enumSelectionFromQuery(initialNavigation.documentType) : [])
const initialStatuses = enumSelectionFromQuery(initialNavigation.status).filter(value => config.value.views.some(view => view.key === value))
const statusView = shallowRef<string | string[]>(centralReadOnly.value && initialNavigation.status !== null ? initialStatuses : config.value.defaultView)
const page = shallowRef(centralReadOnly.value ? initialNavigation.page : 1)
const pageSize = shallowRef(centralReadOnly.value ? initialNavigation.pageSize : 10)

function selectedQuery(value: string | string[]): string | string[] | null {
  const values = enumSelectionFromQuery(value)
  return values.length > 1 ? values : values[0] ?? null
}

function queryText(key: 'project' | 'contract' | 'supplier'): string {
  const value = route.query[key]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

const routeProject = computed(() => centralReadOnly.value
  ? String(route.query.projectId ?? '')
  : queryText('project'))
const routeContract = computed(() => centralReadOnly.value
  ? String(route.query.contractId ?? '')
  : queryText('contract'))
const routeSupplier = computed(() => centralReadOnly.value
  ? String(route.query.supplierId ?? route.query.supplier ?? '')
  : queryText('supplier'))

const filtered = computed(() => centralReadOnly.value
  ? rows.value
  : filterOwnerDocumentRows(props.kind, rows.value, {
      search: search.value,
      project: projectFilter.value,
      type: typeFilter.value,
      statusView: statusView.value,
      routeProject: routeProject.value,
      routeContract: routeContract.value,
      routeSupplier: routeSupplier.value,
    }))
const centralPage = computed(() => hasSnapshot.value ? store.centralPageFor(centralKind.value) : { page: page.value, pageSize: pageSize.value, total: 0 })
const currentPage = computed(() =>
  centralReadOnly.value ? centralPage.value.page : clampPage(page.value, filtered.value.length, pageSize.value),
)
const pageRows = computed(() =>
  centralReadOnly.value ? filtered.value : paginate(filtered.value, currentPage.value, pageSize.value),
)
const totalRows = computed(() => centralReadOnly.value
  ? centralPage.value.total
  : filtered.value.length)
const centralSummary = computed(() => centralReadOnly.value && hasSnapshot.value ? store.centralSummaryFor(centralKind.value) : null)
const canCreate = computed(() => !centralReadOnly.value
  || (hasSnapshot.value && store.centralCapabilitiesFor(centralKind.value).includes(
    (props.kind === 'sub_change' || props.kind === 'sub_settlement' || props.kind === 'project_penalty') ? 'subcontract-document:write' : 'owner-document:write',
  )))
const journeyReturnTo = computed(() => centralReadOnly.value
  ? validateOwnerDocumentJourneyReturnTo(route.query.returnTo, centralKind.value, 'real')
  : null)

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
  centralSummary.value
    ? [{ key: 'all', label: '全部项目' }, ...centralSummary.value.projects.map(option => ({ key: option.id, label: option.label }))]
    : distinctOptions('projectId', row => row.projectName, '全部项目'),
)
const typeOptions = computed(() =>
  centralSummary.value
    ? [{ key: 'all', label: `全部${config.value.typeLabel}` }, ...centralSummary.value.documentTypes.map(option => ({
        key: option.value,
        label: ownerDocumentTypeLabel(props.kind, option.value),
      }))]
    : distinctOptions(
        'type',
        row => ownerDocumentTypeLabel(props.kind, row.type),
        `全部${config.value.typeLabel}`,
      ),
)
const statusOptions = computed(() =>
  config.value.views.map(view => ({
    ...view,
    count: centralSummary.value
      ? view.key === 'all'
        ? centralSummary.value.statuses.reduce((total, option) => total + option.count, 0)
        : centralSummary.value.statuses.reduce(
            (total, option) => total + (ownerDocumentStatusViewKey(props.kind, option.value) === view.key ? option.count : 0),
            0,
          )
      : rows.value.filter(row => view.key === 'all' || ownerDocumentStatusViewKey(props.kind, row.status) === view.key).length,
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
  || enumSelectionFromQuery(typeFilter.value).length > 0
  || serializeEnumSelection(statusView.value) !== serializeEnumSelection(config.value.defaultView),
)
const emptyIsFilterMiss = computed(() => centralReadOnly.value
  ? store.centralEmptyReasonFor(centralKind.value) === 'no-filter-match'
  : hasLocalFilters.value || contextFilters.value.length > 0)
const emptyState = computed(() => {
  if (!emptyIsFilterMiss.value) {
    return {
      title: `暂无${meta.value.label}`,
      description: canCreate.value
        ? `当前业务范围内还没有${meta.value.label}，可从新建开始。`
        : `当前业务范围内还没有${meta.value.label}。`,
      actionLabel: canCreate.value ? `新建${meta.value.label}` : `刷新${meta.value.label}`,
    }
  }
  return {
    title: `没有符合条件的${meta.value.label}`,
    description: '请调整搜索、项目、类型或状态筛选条件。',
    actionLabel: '清除筛选',
  }
})
const summaries = computed(() =>
  config.value.amountSummaries.map((summary) => {
    const subcontractActualApproved = centralSummary.value?.origins.real.subcontractActualApproved
    return {
      label: props.kind === 'sub_change' && summary.field !== 'amount' && subcontractActualApproved?.status === 'partial'
        ? `${summary.label}（部分记录）`
        : summary.label,
      completeness: props.kind === 'sub_change' && summary.field !== 'amount'
        ? subcontractActualApproved?.status ?? null
        : null,
      value: centralSummary.value
        ? props.kind === 'sub_change'
          ? summary.field === 'amount'
            ? Number(centralSummary.value.origins.real.subcontractApprovedAmount)
            : subcontractActualApproved?.value == null ? null : Number(subcontractActualApproved.value)
          : props.kind === 'owner_change'
            ? summary.field === 'amount'
              ? Number(centralSummary.value.origins.real.taxInclusiveAmount)
              : summary.field === 'secondaryAmount'
                ? Number(centralSummary.value.origins.real.taxExclusiveAmount)
                : Number(centralSummary.value.origins.real.appliedTaxExclusiveAmount)
            : props.kind === 'owner_report'
              ? summary.field === 'amount'
                ? Number(centralSummary.value.origins.real.reportedAmount)
                : summary.field === 'secondaryAmount'
                  ? Number(centralSummary.value.origins.real.auditedAmount)
                  : Number(centralSummary.value.origins.real.auditedAmount) - Number(centralSummary.value.origins.real.reportedAmount)
              : Number(centralSummary.value.origins.real.reportedAmount)
        : filtered.value.reduce((total, row) => total + Number(row[summary.field] || 0), 0),
    }
  }),
)

function centralContractTarget(row: OwnerDocumentListRecord): string | null {
  if (!centralReadOnly.value || !row.contractNavigation)
    return null
  const result = resolveNavigationTarget(row.contractNavigation)
  return result.state === 'resolved' ? result.to : null
}
const tableMinWidth = computed(() =>
  config.value.columns.reduce(
    (total, column) => total + (column.width ?? column.minWidth ?? 120),
    0,
  ),
)

function rowActions(row: OwnerDocumentListRecord): RowActionItem[] {
  if (centralReadOnly.value)
    return [{ key: 'edit', label: '查看详情', icon: 'i-lucide-eye' }]
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

let listLoadTicket = 0
function currentLoadScope() {
  return JSON.stringify([props.kind, route.path, centralReadOnly.value, search.value, projectFilter.value, routeContract.value, routeSupplier.value, selectedQuery(statusView.value), selectedQuery(typeFilter.value), acceptanceVariant.value, page.value, pageSize.value])
}

async function load() {
  const ticket = ++listLoadTicket
  const scope = currentLoadScope()
  const requestedPage = page.value
  const requestedSize = pageSize.value
  try {
    await store.loadKind(props.kind, centralReadOnly.value
      ? {
          search: search.value,
          projectId: projectFilter.value === 'all' ? null : projectFilter.value,
          contractId: routeContract.value || null,
          supplierId: routeSupplier.value || null,
          status: selectedQuery(statusView.value),
          documentType: selectedQuery(typeFilter.value),
          variant: props.kind === 'acceptance' ? acceptanceVariant.value : null,
          page: page.value,
          pageSize: pageSize.value as 10 | 20 | 50 | 100,
        }
      : undefined)
    if (ticket !== listLoadTicket || scope !== currentLoadScope() || !centralReadOnly.value || !hasSnapshot.value)
      return
    const pagination = store.centralPageFor(centralKind.value)
    if (pagination.requestedPage === requestedPage && pagination.pageSize === requestedSize && pagination.page !== requestedPage)
      page.value = pagination.page
  }
  catch {
    // Store 持有当前类型的可重试错误态，避免生命周期出现未处理拒绝。
  }
}

function openCreate() {
  void navigateTo(ownerDocumentFormPath(props.kind))
}

async function openEdit(row: OwnerDocumentListRecord) {
  if (!centralReadOnly.value) {
    await navigateTo(ownerDocumentFormPath(props.kind, row.id))
    return
  }
  const kind = props.kind as OwnerCommercialDocumentKind
  const contextId = newOwnerDocumentReturnContextId()
  const origin = createOwnerDocumentReturnOrigin({
    kind,
    contextId,
    rowIdentity: `real:${kind}:${row.id}`,
    scrollTop: document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop
      ?? document.scrollingElement?.scrollTop
      ?? window.scrollY,
    now: Date.now(),
    state: {
      search: search.value,
      projectId: projectFilter.value === 'all' ? null : projectFilter.value,
      contractId: routeContract.value || null,
      supplierId: routeSupplier.value || null,
      status: enumSelectionFromQuery(statusView.value),
      documentType: enumSelectionFromQuery(typeFilter.value),
      origin: 'real',
      page: currentPage.value,
      pageSize: pageSize.value as 10 | 20 | 50 | 100,
      variant: kind === 'acceptance' ? acceptanceVariant.value : null,
      returnTo: journeyReturnTo.value,
    },
  })
  saveOwnerDocumentReturnOrigin(origin)
  await navigateTo({
    path: ownerDocumentDetailPath(kind, row.id, 'real', row.viewVariant ?? acceptanceVariant.value).split('?')[0],
    query: {
      origin: 'real',
      ...(kind === 'acceptance' ? { variant: row.viewVariant ?? acceptanceVariant.value } : {}),
      returnTo: origin.returnTo,
      returnContext: contextId,
    },
  })
}

async function clearRouteFilter(key: 'project' | 'contract' | 'supplier') {
  const query = { ...route.query }
  delete query[key]
  if (centralReadOnly.value) {
    delete query.page
    if (key === 'project') {
      delete query.projectId
    }
    if (key === 'contract')
      delete query.contractId
    if (key === 'supplier')
      delete query.supplierId
  }
  await navigateTo({ path: route.path, query }, { replace: true })
}

let resettingFilters = false
let applyingNavigation = false
async function resetFilters(showAllStatuses = false) {
  if (resettingFilters)
    return
  const kind = props.kind
  const path = route.path
  resettingFilters = true
  try {
    if (contextFilters.value.length) {
      const query = { ...route.query }
      delete query.project
      delete query.contract
      delete query.supplier
      delete query.projectId
      delete query.contractId
      delete query.supplierId
      await navigateTo({ path: route.path, query }, { replace: true })
    }
    if (props.kind !== kind || route.path !== path)
      return
    search.value = ''
    projectFilter.value = 'all'
    typeFilter.value = 'all'
    statusView.value = showAllStatuses ? 'all' : config.value.defaultView
    await nextTick()
  }
  finally {
    resettingFilters = false
    if (centralReadOnly.value && props.kind === kind && route.path === path)
      void load()
  }
}

function handleEmptyAction() {
  if (emptyIsFilterMiss.value)
    void resetFilters(centralReadOnly.value)
  else if (canCreate.value)
    openCreate()
  else
    void load()
}

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize as 10 | 20 | 50 | 100
}

async function handleRowAction(action: string, row: OwnerDocumentListRecord) {
  if (action === 'edit') {
    await openEdit(row)
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

watch([search, projectFilter, typeFilter, statusView, routeProject, routeContract, routeSupplier], () => {
  if (!applyingNavigation)
    page.value = 1
})
watch(acceptanceVariant, () => {
  if (!applyingNavigation) {
    page.value = 1
    statusView.value = 'all'
  }
})
watch(
  () => props.kind,
  () => {
    search.value = ''
    projectFilter.value = 'all'
    typeFilter.value = 'all'
    statusView.value = config.value.defaultView
    page.value = 1
    if (!centralReadOnly.value)
      void load()
  },
)
// 筛选与重置页码在同一轮更新完成后，只请求最终查询一次。
watch([() => props.kind, search, projectFilter, typeFilter, statusView, routeContract, routeSupplier, acceptanceVariant, page, pageSize], () => {
  if (centralReadOnly.value && !resettingFilters)
    void load()
}, { flush: 'post' })

let hasActivated = false
let restoredRoute = ''
watch(() => route.query, async (query, previousQuery) => {
  if (!centralReadOnly.value || route.path !== listPath || resettingFilters)
    return
  const navigation = ownerDocumentListNavigationStateFromQuery(query, centralKind.value)
  const previousNavigation = ownerDocumentListNavigationStateFromQuery(previousQuery, centralKind.value)
  const contextChanged = navigation.contractId !== previousNavigation.contractId
    || navigation.supplierId !== previousNavigation.supplierId
    || (props.kind === 'acceptance' && (navigation.variant ?? 'acceptance') !== (previousNavigation.variant ?? 'acceptance'))
  const types = enumSelectionFromQuery(navigation.documentType)
  const statuses = navigation.status === null
    ? config.value.defaultView
    : enumSelectionFromQuery(navigation.status).filter(value => config.value.views.some(view => view.key === value))
  const next = [navigation.search, navigation.projectId ?? 'all', serializeEnumSelection(types), serializeEnumSelection(statuses), navigation.page, navigation.pageSize]
  const current = [search.value, projectFilter.value, serializeEnumSelection(typeFilter.value), serializeEnumSelection(statusView.value), page.value, pageSize.value]
  if (JSON.stringify(next) === JSON.stringify(current) && !contextChanged)
    return
  applyingNavigation = true
  search.value = navigation.search
  projectFilter.value = navigation.projectId ?? 'all'
  typeFilter.value = types
  statusView.value = statuses
  page.value = navigation.page
  pageSize.value = navigation.pageSize
  await nextTick()
  applyingNavigation = false
}, { flush: 'sync' })

watch([search, projectFilter, typeFilter, statusView, page, pageSize], () => {
  if (!centralReadOnly.value || applyingNavigation)
    return
  const query = { ...route.query }
  if (search.value)
    query.search = search.value
  else
    delete query.search
  if (projectFilter.value !== 'all')
    query.projectId = projectFilter.value
  else
    delete query.projectId
  if (serializeEnumSelection(statusView.value) !== serializeEnumSelection(config.value.defaultView))
    query.status = serializeEnumSelection(statusView.value) || 'all'
  else
    delete query.status
  if (enumSelectionFromQuery(typeFilter.value).length)
    query.documentType = serializeEnumSelection(typeFilter.value)
  else
    delete query.documentType
  if (page.value !== 1)
    query.page = String(page.value)
  else
    delete query.page
  if (pageSize.value !== 20)
    query.pageSize = String(pageSize.value)
  else
    delete query.pageSize
  void router.replace({ path: route.path, query })
})

async function restoreReturnOrigin() {
  if (!centralReadOnly.value || loading.value || loadError.value || !hasSnapshot.value
    || route.path !== listPath || restoredRoute === route.fullPath || !isOwnerDocumentReturnContextId(route.query.nav)) {
    return
  }
  const fullPath = route.fullPath
  const isCurrent = () => route.fullPath === fullPath && route.path === listPath
    && !loading.value && !loadError.value && hasSnapshot.value && listRoot.value?.isConnected
  const kind = props.kind as OwnerCommercialDocumentKind
  const validated = validateOwnerDocumentListReturnTo(fullPath, kind, 'real')
  const origin = loadOwnerDocumentReturnOrigin(route.query.nav)
  if (!validated || !origin || origin.returnTo !== validated || origin.expiresAt <= Date.now())
    return
  let anchor: HTMLElement | null = null
  for (let attempt = 0; attempt < 4 && !anchor; attempt += 1) {
    await nextTick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (!isCurrent())
      return
    anchor = [...listRoot.value!.querySelectorAll<HTMLElement>('[id]')].find(node => node.id === origin.anchorId) ?? null
  }
  if (!anchor)
    return
  const workspace = listRoot.value!.closest<HTMLElement>('[data-shell-workspace]')
  if (workspace)
    workspace.scrollTop = origin.scrollTop
  else
    window.scrollTo({ top: origin.scrollTop })
  anchor.focus({ preventScroll: true })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  if (!isCurrent())
    return
  if (workspace)
    workspace.scrollTop = origin.scrollTop
  restoredRoute = fullPath
}

watch(() => [loading.value, loadError.value, hasSnapshot.value, rows.value.length, route.fullPath], () => void restoreReturnOrigin(), { flush: 'post' })

onMounted(async () => {
  await load()
  await restoreReturnOrigin()
})
onActivated(async () => {
  if (!hasActivated) {
    hasActivated = true
    return
  }
  await load()
  await restoreReturnOrigin()
})
</script>

<template>
  <div ref="listRoot" class="flex min-w-0 flex-col gap-3">
    <TargetCostSourceReturn v-if="kind === 'sub_settlement' && centralReadOnly" />
    <div v-if="journeyReturnTo" class="flex">
      <NuxtLink :to="journeyReturnTo" class="btn-ghost text-12px">
        <span class="i-lucide-arrow-left mr-1" aria-hidden="true" />返回来源详情
      </NuxtLink>
    </div>
    <nav v-if="kind === 'acceptance'" class="panel flex flex-wrap gap-2 p-2" aria-label="验收保修列表视图">
      <NuxtLink
        v-for="item in [{ key: 'acceptance', label: '竣工验收' }, { key: 'warranty', label: '保修到期确认' }]"
        :key="item.key"
        :to="{ path: route.path, query: { ...route.query, variant: item.key, page: undefined } }"
        class="btn-ghost min-h-9"
        :class="{ 'bg-brand-soft text-brand-deep': acceptanceVariant === item.key }"
        :aria-current="acceptanceVariant === item.key ? 'page' : undefined"
      >
        {{ item.label }}
      </NuxtLink>
    </nav>
    <OwnerDocumentListToolbar
      v-model:search="search"
      v-model:project="projectFilter"
      v-model:type="typeFilter"
      v-model:view="statusView"
      :title="meta.label"
      :subtitle="meta.subtitle"
      :create-label="`新建${meta.label}`"
      :can-create="canCreate"
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
      :description="hasSnapshot ? `${loadError}；当前保留上一次成功读取的列表。` : loadError"
      :compact="hasSnapshot"
      action-label="重新载入"
      @action="load"
    />

    <div v-if="!loadError || loading || hasSnapshot" class="min-w-0">
      <div
        data-ui="owner-document-table"
        :aria-busy="loading"
        role="region"
        :aria-label="`${meta.label}列表，可横向滚动查看完整列`"
        tabindex="0"
        class="max-w-full overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] outline-none focus-visible:ring-2 focus-visible:ring-brand/35"
      >
        <KitTable
          :columns="config.columns"
          :data="pageRows"
          :loading="loading && !hasSnapshot"
          :page="{ page: currentPage, pageSize, total: totalRows }"
          :empty="emptyState"
          :style="{ minWidth: kind === 'sub_settlement' && !pageRows.length ? '100%' : `${tableMinWidth}px`, maxWidth: 'none' }"
          @page-change="handlePageChange"
          @empty-action="handleEmptyAction"
        >
          <template #document="{ row }">
            <NuxtLink
              v-if="centralReadOnly"
              :id="`owner-document-row-real:${kind}:${row.id}`"
              :to="ownerDocumentDetailPath(kind, row.id, 'real', row.viewVariant ?? acceptanceVariant)"
              class="cell--link whitespace-nowrap font-mono"
              :title="row.no || row.name"
              @click.prevent="openEdit(row)"
            >
              {{ row.no || '未编号' }}
            </NuxtLink>
            <NuxtLink
              v-else
              :to="ownerDocumentFormPath(kind, row.id)"
              class="cell--link whitespace-nowrap font-mono"
              :title="row.no || row.name"
            >
              {{ row.no || '未编号' }}
            </NuxtLink>
          </template>
          <template #project="{ row }">
            <EntityLink :id="row.projectId" type="project" :label="row.projectName" :intent="row.projectNavigation" />
          </template>
          <template #contract="{ row }">
            <NuxtLink v-if="centralContractTarget(row)" :to="centralContractTarget(row)!" class="cell--link">
              {{ row.contractName }}
            </NuxtLink>
            <EntityLink v-else :id="row.contractId" type="contract" :label="row.contractName" />
          </template>
          <template #supplier="{ row }">
            <EntityLink
              :id="row.supplierId"
              type="supplier"
              :label="row.supplierName || row.crewName"
              :intent="row.supplierNavigation"
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
        <span>{{ config.countLabel }}：<strong class="text-ink">{{ totalRows }}</strong></span>
        <span v-for="summary in summaries" :key="summary.label">
          {{ summary.label }}：
          <strong class="whitespace-nowrap font-mono text-ink">{{ yuan(summary.value) }}</strong>
          <span v-if="summary.completeness === 'missing'" class="ml-1 text-ink-faint">尚未回填</span>
        </span>
        <button
          v-if="totalRows > 0 && (hasLocalFilters || contextFilters.length)"
          type="button"
          class="border-0 bg-transparent p-0 text-12px font-700 text-brand-deep"
          @click="resetFilters()"
        >
          清除筛选
        </button>
      </div>
    </div>
  </div>
</template>
