<script setup lang="ts">
import type { ColumnFilterValue } from '~/components/ui/KitColumnHeader.vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { SupplierListColumnFilters, SupplierListNumericField, SupplierListPageDTO, SupplierListQueryDTO, SupplierListSort, SupplierListTextField } from '~/lib/supplier/repository'
import { useDebounceFn, useMediaQuery, useStorage } from '@vueuse/core'
import { computed, nextTick, onActivated, onMounted, shallowRef, watch } from 'vue'
import { createSupplierReturnTo, supplierListNavigationStateFromQuery } from '~/lib/supplier/return-context'
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE, SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { yuan } from '~/lib/util/money'
import { useSupplierCommandStore } from '~/stores/supplier-command'
import { useSupplierReadStore } from '~/stores/supplier-read'

const route = useRoute()
const readStore = useSupplierReadStore()
const commandStore = useSupplierCommandStore()
const visibility = useDataVisibilityStore()
const { error, typeSelect } = useKitUI()
const initial = supplierListNavigationStateFromQuery(route.query)
const search = shallowRef(initial.search)
const category = shallowRef(initial.category)
const credentialStatus = shallowRef(initial.credentialStatus)
const sort = shallowRef<SupplierListSort>(initial.sort)
const page = shallowRef(initial.page)
const pageSize = shallowRef(initial.pageSize)
const columnFilters = shallowRef<SupplierListColumnFilters>(initial.columnFilters ?? {})
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

const readPage = computed<SupplierListPageDTO | null>(() => {
  const state = readStore.listState
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
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
const problem = computed(() => ['forbidden', 'not-found', 'mismatch', 'error'].includes(readStore.listState.kind) && 'problem' in readStore.listState ? readStore.listState.problem : null)
const categoryOptions = computed(() => [
  { key: 'all', label: '全部类别' },
  ...(readPage.value?.summary.categories ?? []).map(item => ({ key: item.value, label: `${item.label}（${item.count}）` })),
])
const credentialOptions = computed(() => [
  { key: 'all', label: '全部资料状态' },
  ...(readPage.value?.summary.credentialStatuses ?? []).map(item => ({ key: item.value, label: `${CREDENTIAL_STATUS_LABEL[item.value] ?? item.label}（${item.count}）` })),
])
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
  { field: 'paymentAmount', title: '确认实付', type: 'money', width: 130 },
  { field: 'projectCount', title: '合作项目数', width: 110, align: 'right' },
  { field: 'businessLicense', title: '营业执照', width: 110, slot: 'businessLicense' },
  { title: '操作', type: 'action', width: 55 },
]
const numericFields = new Set(['settlementAmount', 'cumulativeContractAmount', 'contractAmount', 'paymentAmount', 'projectCount'])
const enumFields = new Set(['supplierCategory', 'credentialStatus', 'taxpayerType'])
const columns = computed(() => allColumns
  .filter(col => !col.field || col.field === 'name' || !hiddenColumns.value.includes(col.field))
  .map(col => ({
    ...col,
    ...(col.field && col.field !== 'businessLicense' ? { customHeader: true } : {}),
    ...(fixedName.value && (col.type === 'seq' || col.field === 'name') ? { fixed: 'left' as const } : {}),
  })))
const hasFilters = computed(() => Boolean(search.value || category.value !== 'all' || credentialStatus.value !== 'all'
  || Object.values(columnFilters.value.contains ?? {}).some(Boolean) || columnFilters.value.taxpayerType
  || Object.values(columnFilters.value.ranges ?? {}).some(range => range?.min !== undefined || range?.max !== undefined)))

function columnValue(field: string): ColumnFilterValue {
  if (field === 'supplierCategory')
    return category.value === 'all' ? '' : category.value
  if (field === 'credentialStatus')
    return credentialStatus.value === 'all' ? '' : credentialStatus.value
  if (field === 'taxpayerType')
    return columnFilters.value.taxpayerType ?? ''
  if (numericFields.has(field))
    return columnFilters.value.ranges?.[field as SupplierListNumericField] ?? {}
  return columnFilters.value.contains?.[field as SupplierListTextField] ?? ''
}

function columnOptions(field: string) {
  if (field === 'supplierCategory')
    return categoryOptions.value.filter(item => item.key !== 'all')
  if (field === 'credentialStatus')
    return credentialOptions.value.filter(item => item.key !== 'all')
  return (readPage.value?.summary.taxpayerTypes ?? []).map(item => ({ key: item.value, label: `${item.label}（${item.count}）` }))
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
    category.value = String(value) || 'all'
  else if (field === 'credentialStatus')
    credentialStatus.value = String(value) || 'all'
  else if (field === 'taxpayerType')
    columnFilters.value = { ...columnFilters.value, taxpayerType: String(value) || null }
  else if (numericFields.has(field))
    columnFilters.value = { ...columnFilters.value, ranges: { ...columnFilters.value.ranges, [field]: value } }
  else columnFilters.value = { ...columnFilters.value, contains: { ...columnFilters.value.contains, [field]: value } }
}

function resetView() {
  hiddenColumns.value = []
  comfortable.value = false
}

function currentQuery(): SupplierListQueryDTO {
  return {
    includeDemo: visibility.includeDemo,
    search: search.value,
    category: category.value === 'all' ? null : category.value,
    credentialStatus: credentialStatus.value === 'all' ? null : credentialStatus.value,
    columnFilters: columnFilters.value,
    sort: sort.value,
    page: page.value,
    pageSize: pageSize.value,
  }
}

let returnFocusPending = true

async function load() {
  await readStore.loadList(currentQuery())
  if (readPage.value)
    page.value = readPage.value.pagination.page
  if (returnFocusPending && ['ready', 'partial', 'empty'].includes(readStore.listState.kind) && route.path === '/base/supplier') {
    returnFocusPending = false
    await focusReturnAnchor()
  }
}

async function focusReturnAnchor() {
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
    const target = [...document.querySelectorAll<HTMLElement>('[data-supplier-row-link]')].find(element =>
      candidates.has(element.parentElement?.id ?? '') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
    )
    if (target) {
      target.focus({ preventScroll: true })
      return
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
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
  category.value = 'all'
  credentialStatus.value = 'all'
  columnFilters.value = {}
  page.value = 1
  void load()
}

watch([search, category, credentialStatus, sort, columnFilters], debouncedLoad)
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
    <StatePanel v-if="problem" :kind="problem.code === 'forbidden' ? 'forbidden' : 'error'" title="分供方列表加载失败" :description="problem.message" :action-label="problem.retryable ? '重新加载' : ''" :compact="Boolean(readPage)" @action="load" />
    <ListShell v-if="!problem || readPage" continuous class="supplier-reference-list">
      <template #toolbar>
        <SupplierListControls
          v-model:search="search" v-model:category="category" v-model:credential-status="credentialStatus"
          v-model:sort="sort" v-model:hidden-columns="hiddenColumns" v-model:comfortable="comfortable"
          :columns="allColumns" :loading="loading" :category-options="categoryOptions" :credential-options="credentialOptions"
          :has-filters="hasFilters" :can-write="Boolean(readPage?.capabilities.includes('supplier:write'))"
          @refresh="load" @create="createSupplier" @import="navigateTo('/import/mapping/supplier')" @clear="clearFilters" @reset-view="resetView"
        />
      </template>
      <template #table>
        <div data-ui="supplier-list-table" class="min-w-0 max-w-full">
          <KitTable
            :columns="columns"
            :data="rows"
            :loading="loading"
            :row-height="comfortable ? 44 : 32"
            :page="{ page, pageSize, total: readPage?.pagination.total ?? 0 }"
            :page-size-options="[10, 20, 50, 100]"
            :empty="{ title: hasFilters ? '没有符合条件的分供方' : '还没有分供方档案', actionLabel: hasFilters ? '清除筛选' : '新建分供方' }"
            row-key="identity"
            @empty-action="hasFilters ? clearFilters() : createSupplier()"
            @page-change="({ page: nextPage, pageSize: nextSize }) => { page = nextPage; pageSize = nextSize as 10 | 20 | 50 | 100; load() }"
          >
            <template #columnHeader="{ column }">
              <KitColumnHeader
                :title="column.title" :kind="numericFields.has(column.field!) ? 'number' : enumFields.has(column.field!) ? 'enum' : 'text'"
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
            <template #businessLicense="{ row }">
              <span v-if="row.businessLicense?.state === 'unavailable'" title="营业执照来源尚未接通">—</span>
              <NuxtLink v-else :to="`/base/supplier/credential/${encodeURIComponent(row.id)}?origin=${row.dataOrigin}&returnTo=${encodeURIComponent(detailTo(row))}`" class="cell--link">
                {{ row.businessLicense?.state === 'available' ? `${row.businessLicense.fileCount} 份` : '未上传' }}
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
