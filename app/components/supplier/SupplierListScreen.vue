<script setup lang="ts">
import type { ColumnFilterValue } from '~/components/ui/KitColumnHeader.vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { SupplierListColumnFilters, SupplierListNumericField, SupplierListPageDTO, SupplierListQueryDTO, SupplierListSort, SupplierListTextField } from '~/lib/supplier/repository'
import { useDebounceFn, useMediaQuery, useStorage } from '@vueuse/core'
import { computed, nextTick, onActivated, onDeactivated, onMounted, onScopeDispose, shallowRef, watch } from 'vue'
import EntityPendingRecovery from '~/components/shared/EntityPendingRecovery.vue'
import SupplierListControls from '~/components/supplier/SupplierListControls.vue'
import { readProblemTitle, readStateData, readStateProblem } from '~/lib/read-model/state'
import { SUPPLIER_LIST_NUMERIC_FIELDS, SUPPLIER_NUMERIC_SOURCE } from '~/lib/supplier/read-contract'
import { normalizeSupplierEnumSelection } from '~/lib/supplier/read-query'
import { createSupplierReturnTo, supplierListNavigationQuery, supplierListNavigationStateFromQuery } from '~/lib/supplier/return-context'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE, CREDENTIAL_STATUSES, SUPPLIER_CATEGORIES, SUPPLIER_TAXPAYER_TYPES } from '~/lib/supplier/status'
import { yuan } from '~/lib/util/money'
import { useSupplierCommandStore } from '~/stores/supplier-command'
import { useSupplierReadStore } from '~/stores/supplier-read'

const route = useRoute()
const router = useRouter()
const readStore = useSupplierReadStore()
const commandStore = useSupplierCommandStore()
const visibility = useDataVisibilityStore()
const { error, typeSelect } = useKitUI()
const initial = supplierListNavigationStateFromQuery(route.query)
const search = shallowRef(initial.search)
const category = shallowRef(normalizeSupplierEnumSelection(initial.category))
const credentialStatus = shallowRef(normalizeSupplierEnumSelection(initial.credentialStatus))
const sort = shallowRef<SupplierListSort>(initial.sort)
const page = shallowRef(initial.page)
const pageSize = shallowRef(initial.pageSize)
const columnFilters = shallowRef<SupplierListColumnFilters>(initial.columnFilters ?? {})
const taxpayerType = computed({
  get: () => normalizeSupplierEnumSelection(columnFilters.value.taxpayerType),
  set: (value: string[]) => {
    columnFilters.value = { ...columnFilters.value, taxpayerType: value,
    }
  },
})
const businessLicense = computed({
  get: () => columnFilters.value.businessLicense ?? [],
  set: (value: NonNullable<SupplierListColumnFilters['businessLicense']>) => {
    columnFilters.value = { ...columnFilters.value, businessLicense: value,
    }
  },
})
const hiddenColumns = useStorage<string[]>('ruihang:supplier-list:columns:v1', [], undefined, {
  serializer: {
    read: (raw) => {
      try {
        const value: unknown = JSON.parse(raw)
        return Array.isArray(value) ? value.filter((field): field is string => typeof field === 'string') : []
      }
      catch { return [] }
    },
    write: value => JSON.stringify(value),
  },
})
const comfortable = useStorage('ruihang:supplier-list:comfortable:v1', false)
const fixedName = useMediaQuery('(min-width: 768px)')

const readPage = computed<SupplierListPageDTO | null>(() => readStateData(readStore.listState))
const unavailableSourceLabel = computed(() => {
  const labels = { projects: '项目', contracts: '合同', settlements: '结算', invoices: '发票', payments: '付款' }
  const sources = (readPage.value?.unavailableSources ?? []).map(source => labels[source])
  return sources.length > 1 ? `${sources.slice(0, -1).join('、')}与${sources.at(-1)}` : sources[0]
})
const rows = computed(() => (readPage.value?.items ?? []).map(item => ({
  id: item.supplier.id,
  identity: `${item.dataOrigin}:${item.supplier.id}`,
  name: item.supplier.label,
  dataOrigin: item.dataOrigin,
  aliases: item.aliases,
  taxNo: item.taxNo,
  uniqueCode: item.uniqueCode,
  address: item.address,
  taxpayerType: item.taxpayerType,
  mainBusiness: item.mainBusiness,
  laborScope: item.laborScope,
  bank: item.bank,
  bankAccount: item.bankAccount,
  businessType: item.businessType,
  settlementAmount: item.settlementAmount,
  cumulativeContractAmount: item.cumulativeContractAmount,
  businessLicense: item.businessLicense,
  supplierCategory: item.supplierCategory,
  credentialStatus: item.credentialStatus,
  contact: item.contact,
  contactPhone: item.contactPhone,
  projectCount: item.projectCount,
  contractAmount: item.contractAmount,
  paymentAmount: item.paymentAmount,
})))
const loading = computed(() => readStore.listState.kind === 'loading')
const problem = computed(() => readStateProblem(readStore.listState))
function enumOptions(values: readonly string[], selected: string[], facets: { value: string, label: string, count: number }[] = [], labels: Record<string, string> = {}) {
  const counts = new Map(facets.map(item => [item.value, item]))
  return [...new Set([...values, ...facets.map(item => item.value), ...selected])].filter(Boolean).map(key => ({
    key,
    label: `${labels[key] ?? counts.get(key)?.label ?? key}（${counts.get(key)?.count ?? 0}）`,
  }))
}
const categoryOptions = computed(() => enumOptions(SUPPLIER_CATEGORIES, category.value, readPage.value?.summary.categories))
const credentialOptions = computed(() => enumOptions(CREDENTIAL_STATUSES, credentialStatus.value, readPage.value?.summary.credentialStatuses, CREDENTIAL_STATUS_LABEL))
const taxpayerOptions = computed(() => enumOptions(SUPPLIER_TAXPAYER_TYPES, taxpayerType.value, readPage.value?.summary.taxpayerTypes))
const businessLicenseOptions = [{ key: 'available', label: '有原件' }, { key: 'missing', label: '缺少原件' }, { key: 'unavailable', label: '不可用' }]
const allColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 42 },
  { field: 'name', title: '分供方名称', width: 180, slot: 'name' },
  { field: 'supplierCategory', title: '分供方类别', width: 105 },
  { field: 'uniqueCode', title: '唯一识别码', width: 100 },
  { field: 'taxNo', title: '统一社会信用代码', width: 165 },
  { field: 'aliases', title: '供应商简称', width: 130, slot: 'aliases' },
  { field: 'address', title: '注册地址', width: 150 },
  { field: 'contact', title: '主要联系人', width: 100 },
  { field: 'contactPhone', title: '联系方式', width: 115 },
  { field: 'credentialStatus', title: '资料状态', width: 90, slot: 'credentialStatus' },
  { field: 'taxpayerType', title: '纳税人类型', width: 115 },
  { field: 'mainBusiness', title: '主营业务', width: 170 },
  { field: 'laborScope', title: '劳务承包范围', width: 160 },
  { field: 'bank', title: '开户行', width: 180 },
  { field: 'bankAccount', title: '银行账号', width: 180 },
  { field: 'businessType', title: '经营类型', width: 125 },
  { field: 'settlementAmount', title: '累计结算金额', type: 'money', width: 145, slot: 'settlementAmount' },
  { field: 'cumulativeContractAmount', title: '累计合同金额', type: 'money', width: 145, slot: 'cumulativeContractAmount' },
  { field: 'contractAmount', title: '有效合同额', type: 'money', width: 140, slot: 'contractAmount' },
  { field: 'paymentAmount', title: '确认实付', type: 'money', width: 130, slot: 'paymentAmount' },
  { field: 'projectCount', title: '合作项目数', width: 110, align: 'right', slot: 'projectCount' },
  { field: 'businessLicense', title: '营业执照', width: 110, slot: 'businessLicense' },
  { title: '操作', type: 'action', width: 55 },
]
const numericFields = new Set<string>(SUPPLIER_LIST_NUMERIC_FIELDS)
const disabledNumericFields = computed<SupplierListNumericField[]>(() => {
  const sources = readPage.value?.unavailableSources ?? []
  return SUPPLIER_LIST_NUMERIC_FIELDS.filter(field => sources.includes(SUPPLIER_NUMERIC_SOURCE[field]))
})
const hasNumericQuery = computed(() => Object.values(columnFilters.value.ranges ?? {}).some(range => range?.min !== undefined || range?.max !== undefined)
  || [...numericFields].some(field => sort.value.startsWith(`${field}-`)))
function clearNumericQuery() {
  columnFilters.value = { ...columnFilters.value, ranges: {} }
  if ([...numericFields].some(field => sort.value.startsWith(`${field}-`)))
    sort.value = 'updated-desc'
}
const enumFields = new Set(['supplierCategory', 'credentialStatus', 'taxpayerType', 'businessLicense'])
const columns = computed(() => allColumns
  .filter(col => !col.field || col.field === 'name' || !hiddenColumns.value.includes(col.field))
  .map(col => ({
    ...col,
    ...(col.field ? { customHeader: true } : {}),
    ...(fixedName.value && (col.type === 'seq' || col.field === 'name') ? { fixed: 'left' as const } : {}),
  })))
const hasFilters = computed(() => Boolean(search.value || category.value.length || credentialStatus.value.length
  || Object.values(columnFilters.value.contains ?? {}).some(Boolean) || taxpayerType.value.length || businessLicense.value.length
  || Object.values(columnFilters.value.ranges ?? {}).some(range => range?.min !== undefined || range?.max !== undefined)))

function columnValue(field: string): ColumnFilterValue {
  if (field === 'supplierCategory')
    return category.value
  if (field === 'credentialStatus')
    return credentialStatus.value
  if (field === 'taxpayerType')
    return taxpayerType.value
  if (field === 'businessLicense')
    return businessLicense.value
  if (numericFields.has(field))
    return columnFilters.value.ranges?.[field as SupplierListNumericField] ?? {}
  return columnFilters.value.contains?.[field as SupplierListTextField] ?? ''
}

function columnOptions(field: string) {
  if (field === 'supplierCategory')
    return categoryOptions.value
  if (field === 'credentialStatus')
    return credentialOptions.value
  if (field === 'businessLicense')
    return businessLicenseOptions
  return taxpayerOptions.value
}

function columnSortOptions(field: string) {
  if (field === 'name')
    return [{ key: 'name-asc', label: '名称升序' }, { key: 'name-desc', label: '名称降序' }]
  if (field === 'supplierCategory')
    return [{ key: 'category-asc', label: '类别升序' }]
  if (numericFields.has(field))
    return [{ key: `${field}-asc`, label: '数值升序' }, { key: `${field}-desc`, label: '数值降序' }]
  return []
}

function applyColumnFilter(field: string, value: ColumnFilterValue) {
  if (field === 'supplierCategory')
    category.value = normalizeSupplierEnumSelection(value)
  else if (field === 'credentialStatus')
    credentialStatus.value = normalizeSupplierEnumSelection(value)
  else if (field === 'taxpayerType')
    taxpayerType.value = normalizeSupplierEnumSelection(value)
  else if (field === 'businessLicense')
    businessLicense.value = normalizeSupplierEnumSelection(value).filter((item): item is 'available' | 'missing' | 'unavailable' => ['available', 'missing', 'unavailable'].includes(item))
  else if (numericFields.has(field) && typeof value === 'object' && !Array.isArray(value))
    columnFilters.value = { ...columnFilters.value, ranges: { ...columnFilters.value.ranges, [field]: value } }
  else if (typeof value === 'string')
    columnFilters.value = { ...columnFilters.value, contains: { ...columnFilters.value.contains, [field]: value } }
}

function resetView() {
  hiddenColumns.value = []
  comfortable.value = false
}

function currentQuery(): SupplierListQueryDTO {
  return {
    includeDemo: visibility.includeDemo,
    search: search.value,
    category: category.value.length ? category.value : null,
    credentialStatus: credentialStatus.value.length ? credentialStatus.value : null,
    columnFilters: columnFilters.value,
    sort: sort.value,
    page: page.value,
    pageSize: pageSize.value,
  }
}

let returnFocusPending = true
let loadGeneration = 0
onDeactivated(() => {
  ++loadGeneration
})
onScopeDispose(() => {
  ++loadGeneration
})

async function load() {
  const generation = ++loadGeneration
  const query = JSON.parse(JSON.stringify(currentQuery())) as SupplierListQueryDTO
  const queryKey = JSON.stringify(query)
  const routeKey = JSON.stringify({ path: route.path, query: route.query, hash: route.hash })
  const isCurrent = () => generation === loadGeneration && route.path === '/base/supplier'
    && JSON.stringify({ path: route.path, query: route.query, hash: route.hash }) === routeKey
    && JSON.stringify(currentQuery()) === queryKey && JSON.stringify(readStore.listQuery) === queryKey
  await readStore.loadList(query)
  if (!isCurrent() || !['ready', 'empty'].includes(readStore.listState.kind) || !readPage.value)
    return
  const actualPage = readPage.value.pagination.page
  if (actualPage !== query.page) {
    const nextQuery = { ...route.query }
    for (const key of ['search', 'category', 'credentialStatus', 'columnFilters', 'sort', 'page', 'pageSize'])
      delete nextQuery[key]
    Object.assign(nextQuery, supplierListNavigationQuery({ ...query, category: query.category ?? [], credentialStatus: query.credentialStatus ?? [], page: actualPage }))
    // The current response alone may canonicalize its own page; stale reads never change another query's URL.
    page.value = actualPage
    await router.replace({ path: route.path, query: nextQuery, hash: route.hash })
  }
  if (generation !== loadGeneration || route.path !== '/base/supplier')
    return
  if (returnFocusPending) {
    returnFocusPending = false
    await focusReturnAnchor(() => generation === loadGeneration && route.path === '/base/supplier')
  }
}

async function focusReturnAnchor(isCurrent: () => boolean) {
  if (!route.hash.startsWith('#'))
    return
  const candidates = new Set<string>([route.hash.slice(1)])
  let decoded = route.hash.slice(1)
  for (let index = 0; index < 3; index += 1) {
    try {
      decoded = decodeURIComponent(decoded)
      candidates.add(decoded)
    }
    catch {
      break
    }
  }
  for (let frame = 0; frame < 4; frame += 1) {
    await nextTick()
    if (!isCurrent())
      return
    const target = [...document.querySelectorAll<HTMLElement>('[data-supplier-row-link]')].find(element =>
      candidates.has(element.parentElement?.id ?? '') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
    )
    if (target) {
      target.focus({ preventScroll: true })
      return
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  if (isCurrent())
    document.querySelector<HTMLElement>('[data-supplier-list-return-fallback]')?.focus({ preventScroll: true })
}

const debouncedLoad = useDebounceFn(() => {
  page.value = 1
  void load()
}, 180)

function detailTo(row: typeof rows.value[number]) {
  const returnTo = createSupplierReturnTo(row.identity, {
    search: search.value,
    category: category.value,
    credentialStatus: credentialStatus.value,
    columnFilters: columnFilters.value,
    sort: sort.value,
    page: page.value,
    pageSize: pageSize.value,
  })
  return `/base/supplier/${encodeURIComponent(row.id)}?origin=${row.dataOrigin}&returnTo=${encodeURIComponent(returnTo)}`
}

async function createSupplier() {
  if (!readPage.value?.capabilities.includes('supplier:write')) {
    error('无分供方写入权限')
    return
  }
  const selected = await typeSelect({
    title: '选择分供方类别',
    options: SUPPLIER_CATEGORIES.map(value => ({ value, label: value })),
    defaultValue: SUPPLIER_CATEGORIES[0],
    confirmLabel: '进入新建表单',
  })
  if (selected)
    void navigateTo({ path: '/base/supplier/form', query: { category: selected } })
}

function clearFilters() {
  search.value = ''
  category.value = []
  credentialStatus.value = []
  columnFilters.value = {}
  page.value = 1
}

watch([search, category, credentialStatus, sort, columnFilters], debouncedLoad)
watch([search, category, credentialStatus, sort, columnFilters, page, pageSize], () => {
  ++loadGeneration
}, { flush: 'sync' })
watch(() => visibility.includeDemo, () => {
  page.value = 1
  void load()
})
watch(() => commandStore.latestWrite, () => void load(), { deep: true })
onMounted(() => void load())
onActivated(() => {
  returnFocusPending = true
  void load()
})
</script>

<template>
  <div class="grid min-w-0 gap-3">
    <EntityPendingRecovery
      v-if="readPage?.capabilities.includes('supplier:persistent:write')"
      class="min-w-0"
      entity-label="分供方"
      description="保存结果尚未确认。先核对主档、证照或税务核验的原提交，再登记新资料。"
      :load-pending-forms="commandStore.pendingForms"
    />
    <p v-if="readPage?.unavailableSources?.length" class="m-0 border border-line bg-panel p-3 text-12px text-ink-muted" role="status">
      关联{{ unavailableSourceLabel }}尚未接入，相关数量和金额显示为未知；分供方主档与证照可正常维护。
    </p>
    <StatePanel v-if="problem" :kind="['forbidden', 'unauthenticated'].includes(problem.code) ? 'forbidden' : 'error'" :title="readProblemTitle(problem, '分供方列表加载失败')" :description="problem.message" :action-label="problem.retryable ? '重新加载' : ''" :compact="Boolean(readPage)" @action="load" />
    <button v-if="problem && hasNumericQuery" type="button" class="btn-secondary justify-self-start" @click="clearNumericQuery">
      清除数值条件并重试
    </button>
    <ListShell v-if="!problem || readPage" continuous class="supplier-reference-list">
      <template #toolbar>
        <SupplierListControls
          v-model:search="search" v-model:category="category" v-model:credential-status="credentialStatus"
          v-model:taxpayer-type="taxpayerType"
          v-model:sort="sort" v-model:hidden-columns="hiddenColumns" v-model:comfortable="comfortable"
          :columns="allColumns" :loading="loading" :category-options="categoryOptions" :credential-options="credentialOptions" :taxpayer-options="taxpayerOptions"
          :disabled-numeric-fields="disabledNumericFields"
          :has-filters="hasFilters" :can-write="Boolean(readPage?.capabilities.includes('supplier:write'))"
          @refresh="load" @create="createSupplier" @import="navigateTo('/import/mapping/supplier')" @clear="clearFilters" @reset-view="resetView"
        />
      </template>
      <template #table>
        <div data-ui="supplier-list-table" class="min-w-0 max-w-full" :aria-busy="loading">
          <KitTable
            :columns="columns"
            :data="rows"
            :loading="loading && !readPage"
            :row-height="comfortable ? 44 : 32"
            :page="{ page, pageSize, total: readPage?.pagination.total ?? 0 }"
            :page-size-options="[10, 20, 50, 100]"
            :empty="{ title: hasFilters ? '没有符合条件的分供方' : '还没有分供方档案', actionLabel: hasFilters ? '清除筛选' : '新建分供方' }"
            row-key="identity"
            @empty-action="hasFilters ? clearFilters() : createSupplier()"
            @page-change="({ page: nextPage, pageSize: nextSize }) => {
              page = nextPage; pageSize = nextSize as 10 | 20 | 50 | 100; load()
            }"
          >
            <template #columnHeader="{ column }">
              <span v-if="disabledNumericFields.includes(column.field as SupplierListNumericField)" role="columnheader" :title="`${column.title}尚未接入，暂不支持筛选或排序`">
                {{ column.title }}<span class="sr-only">：尚未接入，暂不支持筛选或排序</span>
              </span>
              <KitColumnHeader
                v-else
                :title="column.title" :kind="numericFields.has(column.field!) ? 'number' : enumFields.has(column.field!) ? 'multi-enum' : 'text'"
                :value="columnValue(column.field!)" :options="columnOptions(column.field!)"
                :sort="sort" :sort-options="columnSortOptions(column.field!)"
                @apply="applyColumnFilter(column.field!, $event)" @sort="sort = $event as SupplierListSort"
              />
            </template>
            <template #name="{ row }">
              <div :id="`supplier-row-${row.identity}`">
                <NuxtLink :to="detailTo(row)" class="cell--link" data-supplier-row-link>
                  {{ row.name }}
                </NuxtLink><span v-if="row.dataOrigin === 'demo'" class="ml-1 text-10px text-ink-faint">测试</span>
              </div>
            </template>
            <template #aliases="{ row }">
              {{ row.aliases.join('、') || '—' }}
            </template>
            <template #credentialStatus="{ row }">
              <KitStatusTag :tone="CREDENTIAL_STATUS_TONE[row.credentialStatus] ?? 'neutral'">
                {{ CREDENTIAL_STATUS_LABEL[row.credentialStatus] ?? '未知状态' }}
              </KitStatusTag>
            </template>
            <template #settlementAmount="{ row }">
              <span :title="row.settlementAmount === null ? '暂无可读取的结算汇总' : undefined">{{ row.settlementAmount === null ? '—' : yuan(row.settlementAmount) }}</span>
            </template>
            <template #cumulativeContractAmount="{ row }">
              <span :title="row.cumulativeContractAmount === null ? '合同金额记录不完整' : undefined">{{ row.cumulativeContractAmount === null ? '—' : yuan(row.cumulativeContractAmount) }}</span>
            </template>
            <template #contractAmount="{ row }">
              <span :title="row.contractAmount === null ? '合同金额记录不完整' : undefined">{{ row.contractAmount === null ? '—' : yuan(row.contractAmount) }}</span>
            </template>
            <template #paymentAmount="{ row }">
              <span :title="row.paymentAmount === null ? '付款尚未接入或当前不可读取' : undefined">{{ row.paymentAmount === null ? '—' : yuan(row.paymentAmount) }}</span>
            </template>
            <template #projectCount="{ row }">
              <span :title="row.projectCount === null ? '合作项目尚未接入或当前不可读取' : undefined">{{ row.projectCount ?? '—' }}</span>
            </template>
            <template #businessLicense="{ row }">
              <span v-if="row.businessLicense?.state === 'unavailable'" title="当前无读取权限或原件来源未接通">不可用</span>
              <NuxtLink v-else :to="`/base/supplier/credential/${encodeURIComponent(row.id)}?origin=${row.dataOrigin}&returnTo=${encodeURIComponent(detailTo(row))}`" class="cell--link">
                {{ row.businessLicense?.state === 'available' ? `${row.businessLicense.fileCount} 份` : '缺少原件' }}
              </NuxtLink>
            </template>
            <template #action="{ row }">
              <RowActionMenu :label="`${row.name}操作`" :items="[{ key: 'detail', label: '查看详情', icon: 'i-lucide-file-text' }]" @select="navigateTo(detailTo(row))" />
            </template>
          </KitTable>
        </div>
      </template>
    </ListShell>
  </div>
</template>

<style scoped>
.supplier-reference-list { min-height: calc(100dvh - 112px); align-content: start; border: 0; border-radius: 0; }
.supplier-reference-list :deep([data-list-shell-toolbar]) { padding: 10px 10px 6px; }
.supplier-reference-list :deep(.vxe-table), .supplier-reference-list :deep(.vxe-table--render-wrapper) { border-radius: 0 !important; }
.supplier-reference-list :deep(.vxe-body--column) { border-right-color: transparent; font-size: 12px; }
.supplier-reference-list :deep(.vxe-header--column) { font-size: 12px; font-weight: 600; color: var(--ink); }
.supplier-reference-list :deep(.cell--link) { text-decoration: none; }
.supplier-reference-list :deep(.cell--link:hover) { text-decoration: underline; }
.supplier-reference-list :deep(.table-pager) { justify-content: flex-end; background: var(--panel); font-size: 12px; border-top: 0; }
.supplier-reference-list :deep(.table-pager__actions) { margin-left: 4px; }
.supplier-reference-list :deep(.table-pager__page-size) { height: 24px; font-size: 12px; }
</style>
