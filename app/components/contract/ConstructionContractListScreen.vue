<script setup lang="ts">
import type { ConstructionContractListPageDTO } from '~/lib/construction-contract/repository'
import type { KitTableColumn } from '~/lib/kit/table'
import type { NavigationIntentDTO, ReadState } from '~/types/read-model'
import { useDebounceFn } from '@vueuse/core'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import ListShell from '~/components/ui/ListShell.vue'
import {
  constructionContractProblemFromUnknown,
  parseConstructionContractListQuery,
} from '~/lib/construction-contract/repository'
import {
  constructionContractListNavigationStateFromQuery,
  createConstructionContractReturnOrigin,
  isConstructionContractReturnContextId,
  loadConstructionContractReturnOrigin,
  newConstructionContractReturnContextId,
  resolveConstructionContractReturnContext,
  saveConstructionContractReturnOrigin,
} from '~/lib/construction-contract/return-context'
import { contractListFilterValues } from '~/lib/contract/list-filters'
import { CONTRACT_STATUSES, contractStatusTone } from '~/lib/contract/status'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { readProblemTitle } from '~/lib/read-model/state'
import { yuan } from '~/lib/util/money'
import { useConstructionContractReadStore } from '~/stores/construction-contract-read'
import { useDataVisibilityStore } from '~/stores/data-visibility'

const route = useRoute()
const router = useRouter()
const store = useConstructionContractReadStore()
const visibilityStore = useDataVisibilityStore()
const state = computed(() => store.listState as ReadState<ConstructionContractListPageDTO>)
const page = computed(() => {
  const current = state.value
  if (current.kind === 'ready' || current.kind === 'empty')
    return current.data
  if ((current.kind === 'loading' || (current.kind === 'error' || current.kind === 'unavailable')) && current.previous)
    return current.previous
  return null
})
const parsedQuery = computed(() => {
  try {
    return { query: parseConstructionContractListQuery({ ...route.query, includeDemo: String(visibilityStore.includeDemo) }), problem: null }
  }
  catch (cause) {
    return { query: null, problem: constructionContractProblemFromUnknown(cause).problem }
  }
})
const query = computed(() => parsedQuery.value.query ?? parseConstructionContractListQuery({ includeDemo: String(visibilityStore.includeDemo) }))
const search = ref(query.value.search)
const statusOptions = CONTRACT_STATUSES.map(value => ({ key: value, label: value }))
const selectedStatuses = computed(() => contractListFilterValues(query.value.status))
const rowNavigationPending = ref(false)
const returnContextId = ref(isConstructionContractReturnContextId(route.query.nav)
  ? route.query.nav
  : newConstructionContractReturnContextId())
const canCreate = computed(() => page.value?.capabilities.includes('construction-contract:write') ?? false)
let restoredRoute = ''

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'no', title: '合同编号', width: 170, fixed: 'left' },
  { field: 'name', title: '合同名称', minWidth: 210, fixed: 'left', slot: 'name' },
  { field: 'dataOrigin', title: '来源', width: 76, slot: 'origin' },
  { field: 'project', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'customer', title: '甲方客户', minWidth: 170, slot: 'customer' },
  { field: 'actualCompletionDate', title: '实际竣工日期', width: 125, slot: 'actualCompletionDate' },
  { field: 'signDate', title: '签约日期', width: 110 },
  { field: 'changed', title: '变更后金额', width: 130, type: 'money', slot: 'changed' },
  { field: 'settled', title: '合同已结算', width: 125, type: 'money', slot: 'settled' },
  { field: 'invoiced', title: '累计开票', width: 120, type: 'money', slot: 'invoiced' },
  { field: 'received', title: '累计收款', width: 120, type: 'money', slot: 'received' },
  { field: 'receivable', title: '按结算应收', width: 125, type: 'money', slot: 'receivable' },
  { field: 'unreceived', title: '开票未回', width: 120, type: 'money', slot: 'unreceived' },
  { field: 'status', title: '状态', width: 110, customHeader: true, slot: 'status' },
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

const commitSearch = useDebounceFn((value: string) => {
  if (!rowNavigationPending.value)
    patchQuery({ search: value.trim(), page: 1 })
}, 250)
watch(search, (value) => {
  rowNavigationPending.value = false
  void commitSearch(value)
})
let listLoadTicket = 0
watch(parsedQuery, async (value) => {
  const ticket = ++listLoadTicket
  if (!value.query)
    return
  const requested = value.query
  await store.loadList(requested)
  if (ticket !== listLoadTicket || parsedQuery.value.query !== requested)
    return
  const current = state.value
  if (current.kind !== 'ready' && current.kind !== 'empty')
    return
  const pagination = current.data.pagination
  if (pagination.requestedPage === requested.page && pagination.pageSize === requested.pageSize && pagination.page !== requested.page)
    patchQuery({ page: pagination.page })
}, { immediate: true })

function returnOrigin(row: ConstructionContractListPageDTO['items'][number], scrollTop = 0) {
  return createConstructionContractReturnOrigin({
    contextId: returnContextId.value,
    rowIdentity: row.rowKey,
    scrollTop,
    now: Date.now(),
    state: { ...constructionContractListNavigationStateFromQuery(route.query), search: search.value.trim() },
  })
}

function link(row: ConstructionContractListPageDTO['items'][number]) {
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

function captureReturnOrigin(row: ConstructionContractListPageDTO['items'][number]) {
  rowNavigationPending.value = true
  try {
    const scrollTop = document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0
    saveConstructionContractReturnOrigin(returnOrigin(row, scrollTop))
  }
  catch {
    // 存储不可用时继续导航，详情返回安全降级到施工合同列表。
  }
}

async function restoreReturnOrigin() {
  if (route.path !== '/contract/construction' || restoredRoute === route.fullPath)
    return
  const result = resolveConstructionContractReturnContext({
    returnTo: route.fullPath,
    contextId: route.query.nav,
    now: Date.now(),
    load: loadConstructionContractReturnOrigin,
  })
  if (!result.origin)
    return
  let anchor: HTMLElement | null = null
  for (let attempt = 0; attempt < 4 && !anchor; attempt += 1) {
    await nextTick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    anchor = document.getElementById(result.origin.anchorId)
  }
  const focusTarget = anchor ?? document.getElementById('construction-contract-list-heading')
  const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (workspace)
    workspace.scrollTop = result.origin.scrollTop
  focusTarget?.focus({ preventScroll: true })
  restoredRoute = route.fullPath
}

watch(() => [state.value.kind, page.value?.items.length, route.fullPath], () => void restoreReturnOrigin(), { flush: 'post' })
onMounted(() => void restoreReturnOrigin())
onActivated(() => void restoreReturnOrigin())
useTabTitle('施工合同')
</script>

<template>
  <ListShell continuous data-testid="construction-contract-list">
    <template #heading>
      <h1 id="construction-contract-list-heading" tabindex="-1" class="text-14px font-700 text-ink outline-none" title="施工收入侧专属列；正式与演示事实按来源隔离。">
        施工合同
      </h1>
    </template>
    <template #actions>
      <div v-if="!parsedQuery.problem" class="relative min-w-0 w-60 max-w-full">
        <span class="i-lucide-search pointer-events-none absolute left-2.5 top-1/2 text-14px text-ink-faint -translate-y-1/2" aria-hidden="true" />
        <input v-model="search" type="search" class="field-input h-8 min-w-0 w-full pl-8 text-13px" placeholder="搜索合同名称或编号" aria-label="搜索施工合同">
      </div>
      <NuxtLink v-if="canCreate" to="/contract/construction/form" class="btn-primary min-h-8 text-13px">
        新建施工合同
      </NuxtLink>
    </template>
    <template v-if="!parsedQuery.problem" #filters>
      <section class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2" aria-label="施工合同筛选">
        <select class="field-input h-8 min-w-0 w-40 max-w-full py-1 text-12px" :value="query.projectId ?? ''" aria-label="筛选项目" @change="patchQuery({ projectId: ($event.target as HTMLSelectElement).value, page: 1 })">
          <option value="">
            全部项目
          </option><option v-for="item in page?.summary.projects ?? []" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
        <select class="field-input h-8 min-w-0 w-40 max-w-full py-1 text-12px" :value="query.customerId ?? ''" aria-label="筛选客户" @change="patchQuery({ customerId: ($event.target as HTMLSelectElement).value, page: 1 })">
          <option value="">
            全部客户
          </option><option v-for="item in page?.summary.customers ?? []" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
        <KitMultiSelectFilter :model-value="selectedStatuses" label="状态" aria-label="筛选状态" :options="statusOptions" @update:model-value="patchQuery({ status: $event, page: 1 })" />
        <select class="field-input h-8 min-w-0 w-32 max-w-full py-1 text-12px" :value="query.pageSize" aria-label="每页数量" @change="patchQuery({ pageSize: Number(($event.target as HTMLSelectElement).value), page: 1 })">
          <option v-for="size in [10, 20, 50, 100]" :key="size" :value="size">
            每页 {{ size }} 条
          </option>
        </select>
      </section>
    </template>

    <template #table>
      <StatePanel v-if="parsedQuery.problem" kind="error" title="施工合同查询条件无效" :description="parsedQuery.problem.message" action-label="清除无效条件" @action="router.replace({ query: {} })" />
      <div v-else-if="page" class="relative min-w-0" :aria-busy="state.kind === 'loading'" data-testid="construction-contract-list-scroll">
        <span v-if="state.kind === 'loading'" role="status" class="pointer-events-none absolute right-3 top-1 z-1 rounded-sm bg-panel px-2 py-1 text-12px text-ink-soft">正在更新列表…</span>
        <StatePanel v-if="(state.kind === 'error' || state.kind === 'unavailable')" kind="error" title="刷新施工合同失败" :description="`${state.problem.message}；当前保留上一次成功读取的列表。`" :action-label="state.problem.retryable ? '重试' : ''" compact @action="store.loadList(query)" />
        <StatePanel v-if="page.receiptsProblem" :kind="page.receiptsProblem.code === 'forbidden' ? 'forbidden' : 'error'" title="收款金额暂不可用" :description="page.receiptsProblem.message" :action-label="page.receiptsProblem.retryable ? '重新读取收款' : ''" compact @action="store.loadList(query)" />
        <KitTable :columns="columns" :data="page.items" :loading="false" :page="page.pagination" :page-size-options="[10, 20, 50, 100]" :empty="{ title: page.empty?.reason === 'no-filter-match' ? '没有符合当前筛选条件的合同' : '暂无施工合同', description: '可调整筛选条件，或新建正式施工合同。' }" row-key="rowKey" @page-change="({ page: nextPage, pageSize: nextSize }) => patchQuery({ page: nextPage, pageSize: nextSize })">
          <template #columnHeader="{ column }">
            <KitColumnHeader :title="column.title" kind="multi-enum" :value="selectedStatuses" :options="statusOptions" @apply="Array.isArray($event) && patchQuery({ status: $event, page: 1 })" />
          </template>
          <template #status="{ row }">
            <KitStatusTag :tone="contractStatusTone(row.status)">
              {{ row.status }}
            </KitStatusTag>
          </template>
          <template #name="{ row }">
            <NuxtLink v-if="link(row)" :id="`construction-contract-row-${row.rowKey}`" :to="link(row)!" class="font-700 text-brand hover:underline" @click="captureReturnOrigin(row)">
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
          <template #customer="{ row }">
            <NuxtLink v-if="relationshipTarget(row.customerNavigation)" :to="relationshipTarget(row.customerNavigation)!" class="text-brand hover:underline">
              {{ row.customer.state === 'resolved' ? row.customer.label : '不可用' }}
            </NuxtLink><span v-else>{{ row.customer.state === 'resolved' ? row.customer.label : '不可用' }}</span>
          </template>
          <template #actualCompletionDate="{ row }">
            {{ row.actualCompletionDate || '未记录' }}
          </template>
          <template #changed="{ row }">
            {{ yuan(row.amounts.changed, '未知') }}
          </template>
          <template #settled="{ row }">
            {{ yuan(row.amounts.settled, '未知') }}
          </template>
          <template #invoiced="{ row }">
            {{ yuan(row.amounts.invoiced, '未知') }}
          </template>
          <template #received="{ row }">
            {{ yuan(row.amounts.received, '未知') }}
          </template>
          <template #receivable="{ row }">
            {{ yuan(row.amounts.bySettlementReceivable, '未知') }}
          </template>
          <template #unreceived="{ row }">
            {{ yuan(row.amounts.invoicedUnreceived, '未知') }}
          </template>
        </KitTable>
      </div>
      <StatePanel v-else-if="state.kind === 'loading' || state.kind === 'idle'" kind="loading" title="正在读取施工合同" description="正在从中央读模型加载列表。" />
      <StatePanel v-else-if="state.kind === 'forbidden'" kind="forbidden" :title="readProblemTitle(state.problem, '无权查看施工合同')" :description="state.problem.message" />
      <StatePanel v-else kind="error" title="施工合同读取失败" :description="(state.kind === 'error' || state.kind === 'unavailable') ? state.problem.message : '中央列表暂不可用'" action-label="重新加载" @action="store.loadList(query)" />
    </template>
  </ListShell>
</template>
