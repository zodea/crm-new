<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { SubcontractContractListPageDTO } from '~/lib/subcontract-contract/repository'
import type { NavigationIntentDTO, ReadState } from '~/types/read-model'
import { useDebounceFn } from '@vueuse/core'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { contractListFilterValues } from '~/lib/contract/list-filters'
import { CONTRACT_STATUSES, CONTRACT_SUB_KINDS } from '~/lib/contract/status'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { parseSubcontractContractListQuery, subcontractContractProblemFromUnknown } from '~/lib/subcontract-contract/repository'
import {
  createSubcontractContractReturnOrigin,
  isSubcontractContractReturnContextId,
  loadSubcontractContractReturnOrigin,
  newSubcontractContractReturnContextId,
  resolveSubcontractContractReturnContext,
  saveSubcontractContractReturnOrigin,
  subcontractContractListNavigationStateFromQuery,
} from '~/lib/subcontract-contract/return-context'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useSubcontractContractReadStore } from '~/stores/subcontract-contract-read'

const route = useRoute()
const router = useRouter()
const store = useSubcontractContractReadStore()
const visibilityStore = useDataVisibilityStore()
const state = computed(() => store.listState as ReadState<SubcontractContractListPageDTO>)
const page = computed(() => {
  const current = state.value
  if (current.kind === 'ready' || current.kind === 'empty')
    return current.data
  if ((current.kind === 'loading' || current.kind === 'error') && current.previous)
    return current.previous
  return null
})
const parsedQuery = computed(() => {
  try {
    return { query: parseSubcontractContractListQuery({ ...route.query, includeDemo: String(visibilityStore.includeDemo) }), problem: null }
  }
  catch (cause) {
    return { query: null, problem: subcontractContractProblemFromUnknown(cause).problem }
  }
})
const query = computed(() => parsedQuery.value.query ?? parseSubcontractContractListQuery({ includeDemo: String(visibilityStore.includeDemo) }))
const search = ref(query.value.search)
const statusOptions = CONTRACT_STATUSES.map(value => ({ key: value, label: value }))
const selectedStatuses = computed(() => contractListFilterValues(query.value.status))
const subKindOptions = CONTRACT_SUB_KINDS.map(value => ({ key: value, label: value }))
const selectedSubKinds = computed(() => contractListFilterValues(query.value.subKind))
const returnContextId = ref(isSubcontractContractReturnContextId(route.query.nav) ? route.query.nav : newSubcontractContractReturnContextId())
const canCreate = computed(() => page.value?.capabilities.includes('subcontract-contract:write') ?? false)
const summaryOrigins = computed(() => (['real', 'demo'] as const)
  .filter(origin => origin === 'real' || visibilityStore.includeDemo || (page.value?.summary.origins[origin].contractCount ?? 0) > 0)
  .map(origin => ({
    origin,
    label: origin === 'demo' ? '演示数据' : '正式数据',
    values: page.value?.summary.origins[origin] ?? { contractCount: 0, changedAmount: '0', settledAmount: '0', paidAmount: '0' },
  })))
let restoredRoute = ''

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'no', title: '合同编号', width: 160, fixed: 'left' },
  { field: 'name', title: '合同名称', minWidth: 210, fixed: 'left', slot: 'name' },
  { field: 'dataOrigin', title: '来源', width: 76, slot: 'origin' },
  { field: 'subKind', title: '分包类别', width: 120, customHeader: true },
  { field: 'project', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'supplier', title: '乙方分供方', minWidth: 170, slot: 'supplier' },
  { field: 'changed', title: '变更后金额', width: 130, slot: 'changed' },
  { field: 'settled', title: '累计结算', width: 125, slot: 'settled' },
  { field: 'invoiced', title: '累计收票', width: 125, slot: 'invoiced' },
  { field: 'paid', title: '累计付款', width: 125, slot: 'paid' },
  { field: 'settlementPayable', title: '按结算应付', width: 130, slot: 'settlementPayable' },
  { field: 'invoicePayable', title: '按收票应付', width: 130, slot: 'invoicePayable' },
  { field: 'completionSettlement', title: '完工审定', width: 125, slot: 'completionSettlement' },
  { field: 'settlementStatus', title: '结算状态', width: 110, slot: 'settlementStatus' },
  { field: 'clearanceStatus', title: '结清状态', width: 110, slot: 'clearanceStatus' },
]

function patchQuery(patch: Record<string, string | string[] | number | null | undefined>) {
  const next = { ...route.query }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0) || (key === 'page' && Number(value) === 1))
      delete next[key]
    else
      next[key] = Array.isArray(value) ? JSON.stringify(value) : String(value)
  }
  void router.replace({ query: next })
}

const commitSearch = useDebounceFn((value: string) => patchQuery({ search: value.trim(), page: 1 }), 250)
watch(search, value => void commitSearch(value))
watch(parsedQuery, value => value.query && void store.loadList(value.query), { immediate: true })

function returnOrigin(row: SubcontractContractListPageDTO['items'][number], scrollTop = 0) {
  return createSubcontractContractReturnOrigin({
    contextId: returnContextId.value,
    rowIdentity: row.rowKey,
    scrollTop,
    now: Date.now(),
    state: { ...subcontractContractListNavigationStateFromQuery(route.query), search: search.value.trim() },
  })
}

function link(row: SubcontractContractListPageDTO['items'][number]) {
  const target = resolveNavigationTarget(row.navigation)
  if (target.state !== 'resolved')
    return null
  const origin = returnOrigin(row)
  return `${target.to}${target.to.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(origin.returnTo)}`
}

function relationshipTarget(intent: NavigationIntentDTO) {
  const target = resolveNavigationTarget(intent)
  return target.state === 'resolved' ? target.to : null
}

function captureReturnOrigin(row: SubcontractContractListPageDTO['items'][number]) {
  try {
    saveSubcontractContractReturnOrigin(returnOrigin(row, document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0))
  }
  catch {
    // 存储不可用时安全降级为返回列表顶部。
  }
}

async function restoreReturnOrigin() {
  if (route.path !== '/contract/subcontract' || restoredRoute === route.fullPath)
    return
  const result = resolveSubcontractContractReturnContext({ returnTo: route.fullPath, contextId: route.query.nav, now: Date.now(), load: loadSubcontractContractReturnOrigin })
  if (!result.origin)
    return
  let anchor: HTMLElement | null = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await nextTick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    anchor ??= document.getElementById(result.origin.anchorId)
  }
  const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (workspace)
    workspace.scrollTop = result.origin.scrollTop
  ;(anchor ?? document.getElementById('subcontract-contract-list-heading'))?.focus({ preventScroll: true })
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  if (workspace)
    workspace.scrollTop = result.origin.scrollTop
  restoredRoute = route.fullPath
}

watch(() => [state.value.kind, page.value?.items.length, route.fullPath], () => void restoreReturnOrigin(), { flush: 'post' })
onMounted(() => void restoreReturnOrigin())
onActivated(() => void restoreReturnOrigin())
useTabTitle('分包合同')
</script>

<template>
  <div class="min-w-0 space-y-3" data-testid="subcontract-contract-list">
    <header class="panel px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="subcontract-contract-list-heading" tabindex="-1" class="text-18px font-850 text-ink outline-none">
            分包合同
          </h1>
        </div>
        <NuxtLink v-if="canCreate" to="/contract/subcontract/form" class="btn-primary">
          新建分包合同
        </NuxtLink>
      </div>
    </header>
    <StatePanel v-if="parsedQuery.problem" kind="error" title="分包合同查询条件无效" :description="parsedQuery.problem.message" action-label="清除无效条件" @action="router.replace({ query: {} })" />
    <section v-else class="panel p-3" aria-label="分包合同筛选">
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <input v-model="search" class="field-input" placeholder="搜索名称或编号" aria-label="搜索分包合同">
        <select class="field-input" :value="query.projectId ?? ''" aria-label="筛选项目" @change="patchQuery({ projectId: ($event.target as HTMLSelectElement).value, page: 1 })">
          <option value="">
            全部项目
          </option><option v-for="item in page?.summary.projects ?? []" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
        <select class="field-input" :value="query.supplierId ?? ''" aria-label="筛选分供方" @change="patchQuery({ supplierId: ($event.target as HTMLSelectElement).value, page: 1 })">
          <option value="">
            全部分供方
          </option><option v-for="item in page?.summary.suppliers ?? []" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
        <KitMultiSelectFilter :model-value="selectedSubKinds" label="分包类别" aria-label="筛选分包类别" :options="subKindOptions" full-width @update:model-value="patchQuery({ subKind: $event, page: 1 })" />
        <KitMultiSelectFilter :model-value="selectedStatuses" label="状态" aria-label="筛选状态" :options="statusOptions" full-width @update:model-value="patchQuery({ status: $event, page: 1 })" />
        <select class="field-input" :value="query.pageSize" aria-label="每页数量" @change="patchQuery({ pageSize: Number(($event.target as HTMLSelectElement).value), page: 1 })">
          <option v-for="size in [10, 20, 50, 100]" :key="size" :value="size">
            每页 {{ size }} 条
          </option>
        </select>
      </div>
    </section>
    <div v-if="!parsedQuery.problem && page" class="relative space-y-3" :aria-busy="state.kind === 'loading'">
      <StatePanel v-if="state.kind === 'error'" kind="error" title="刷新分包合同失败" :description="`${state.problem.message}；当前保留上一次成功读取。`" compact />
      <section class="grid gap-2 md:grid-cols-2" aria-label="分包合同汇总">
        <article v-for="item in summaryOrigins" :key="item.origin" class="panel min-w-0 p-3" :data-testid="`subcontract-summary-${item.origin}`">
          <div class="flex items-center justify-between gap-2">
            <strong class="text-13px text-ink">{{ item.label }}</strong><span class="chip" :class="item.origin === 'demo' ? 'chip-warn' : 'chip-brand'">{{ item.values.contractCount }} 份</span>
          </div>
          <dl class="mt-2 grid grid-cols-3 gap-2 text-11px">
            <div>
              <dt class="text-ink-soft">
                变更后
              </dt><dd class="mt-1 font-700 text-ink">
                {{ yuan(Number(item.values.changedAmount)) }}
              </dd>
            </div>
            <div>
              <dt class="text-ink-soft">
                累计结算
              </dt><dd class="mt-1 font-700 text-ink">
                {{ yuan(Number(item.values.settledAmount)) }}
              </dd>
            </div>
            <div>
              <dt class="text-ink-soft">
                累计付款
              </dt><dd class="mt-1 font-700 text-ink">
                {{ yuan(Number(item.values.paidAmount)) }}
              </dd>
            </div>
          </dl>
        </article>
      </section>
      <section class="panel relative min-w-0 overflow-hidden" data-testid="subcontract-contract-list-scroll">
        <span v-if="state.kind === 'loading'" role="status" class="pointer-events-none absolute right-3 top-1 z-1 rounded-sm bg-panel px-2 py-1 text-12px text-ink-soft">正在更新列表…</span>
        <KitTable :columns="columns" :data="page.items" :loading="false" :page="page.pagination" :page-size-options="[10, 20, 50, 100]" :empty="{ title: page.empty?.reason === 'no-filter-match' ? '没有符合当前筛选条件的合同' : '暂无分包合同', description: '可调整筛选条件，或新建正式分包合同。' }" row-key="rowKey" @page-change="({ page: nextPage, pageSize: nextSize }) => patchQuery({ page: nextPage, pageSize: nextSize })">
          <template #columnHeader="{ column }">
            <KitColumnHeader :title="column.title" kind="multi-enum" :value="selectedSubKinds" :options="subKindOptions" @apply="Array.isArray($event) && patchQuery({ subKind: $event, page: 1 })" />
          </template>
          <template #name="{ row }">
            <NuxtLink v-if="link(row)" :id="`subcontract-contract-row-${row.rowKey}`" :to="link(row)!" class="font-700 text-brand hover:underline" @click="captureReturnOrigin(row)">
              {{ row.name }}
            </NuxtLink><span v-else>{{ row.name }}</span>
          </template>
          <template #origin="{ row }">
            <span class="chip" :class="row.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">{{ row.dataOrigin === 'demo' ? '演示' : '正式' }}</span>
          </template>
          <template #project="{ row }">
            <NuxtLink v-if="relationshipTarget(row.projectNavigation)" :to="relationshipTarget(row.projectNavigation)!" class="text-brand hover:underline">
              {{ row.project.state === 'resolved' ? row.project.label : '不可用' }}
            </NuxtLink><span v-else>{{ row.project.state === 'resolved' ? row.project.label : '不可用' }}</span>
          </template>
          <template #supplier="{ row }">
            <NuxtLink v-if="relationshipTarget(row.supplierNavigation)" :to="relationshipTarget(row.supplierNavigation)!" class="text-brand hover:underline">
              {{ row.supplier.state === 'resolved' ? row.supplier.label : '不可用' }}
            </NuxtLink><span v-else>{{ row.supplier.state === 'resolved' ? row.supplier.label : '不可用' }}</span>
          </template>
          <template #changed="{ row }">
            {{ yuan(Number(row.amounts.changed)) }}
          </template><template #settled="{ row }">
            {{ yuan(Number(row.amounts.settled)) }}
          </template><template #invoiced="{ row }">
            {{ yuan(Number(row.amounts.invoiced)) }}
          </template><template #paid="{ row }">
            {{ yuan(Number(row.amounts.paid)) }}
          </template><template #settlementPayable="{ row }">
            {{ yuan(Number(row.amounts.bySettlementPayable)) }}
          </template><template #invoicePayable="{ row }">
            {{ yuan(Number(row.amounts.byInvoicePayable)) }}
          </template><template #completionSettlement="{ row }">
            {{ yuan(Number(row.amounts.completionSettlement)) }}
          </template>
          <template #settlementStatus="{ row }">
            {{ row.settlementStatus || '未记录' }}
          </template><template #clearanceStatus="{ row }">
            {{ row.clearanceStatus || '未记录' }}
          </template>
        </KitTable>
      </section>
    </div>
    <StatePanel v-else-if="!parsedQuery.problem && (state.kind === 'loading' || state.kind === 'idle')" kind="loading" title="正在读取分包合同" description="正在从中央读模型加载列表。" />
    <StatePanel v-else-if="!parsedQuery.problem && state.kind === 'forbidden'" kind="forbidden" title="无权查看分包合同" :description="state.problem.message" />
    <StatePanel v-else-if="!parsedQuery.problem" kind="error" title="分包合同读取失败" :description="state.kind === 'error' ? state.problem.message : '中央列表暂不可用'" action-label="重新加载" @action="store.loadList(query)" />
  </div>
</template>
