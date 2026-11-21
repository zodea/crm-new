<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { MaterialContractListPageDTO } from '~/lib/material-contract/repository'
import type { NavigationIntentDTO, ReadState } from '~/types/read-model'
import { useDebounceFn } from '@vueuse/core'
import { onBeforeUnmount, onDeactivated, useTemplateRef } from 'vue'
import TargetCostSourceReturn from '~/components/target-cost/TargetCostSourceReturn.vue'
import KitColumnHeader from '~/components/ui/KitColumnHeader.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import ListShell from '~/components/ui/ListShell.vue'
import { contractListFilterValues } from '~/lib/contract/list-filters'
import { CONTRACT_STATUSES, contractStatusTone } from '~/lib/contract/status'
import { materialContractProblemFromUnknown } from '~/lib/material-contract/read-decoder'
import { materialContractReferenceLabel } from '~/lib/material-contract/reference-state'
import { parseMaterialContractListQuery } from '~/lib/material-contract/repository'
import {
  createMaterialContractReturnOrigin,
  isMaterialContractReturnContextId,
  loadMaterialContractReturnOrigin,
  materialContractListNavigationStateFromQuery,
  newMaterialContractReturnContextId,
  resolveMaterialContractReturnContext,
  saveMaterialContractReturnOrigin,
  validateProjectJourneyReturnTo,
} from '~/lib/material-contract/return-context'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { readProblemTitle, readStateData, readStateProblem } from '~/lib/read-model/state'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useMaterialContractReadStore } from '~/stores/material-contract-read'

const route = useRoute()
const router = useRouter()
const store = useMaterialContractReadStore()
const visibilityStore = useDataVisibilityStore()
const state = computed(() => store.listState as ReadState<MaterialContractListPageDTO>)
const page = computed(() => readStateData(state.value))
const problem = computed(() => readStateProblem(state.value))
const parsedQuery = computed(() => {
  try {
    return {
      query: parseMaterialContractListQuery({
        ...route.query,
        includeDemo: String(visibilityStore.includeDemo),
      }),
      problem: null,
    }
  }
  catch (cause) {
    return {
      query: null,
      problem: materialContractProblemFromUnknown(cause).problem,
    }
  }
})
const query = computed(() => parsedQuery.value.query ?? parseMaterialContractListQuery({
  includeDemo: String(visibilityStore.includeDemo),
}))
const queryProblem = computed(() => parsedQuery.value.problem)
const search = shallowRef(query.value.search)
const statusOptions = CONTRACT_STATUSES.map(value => ({ key: value, label: value }))
const selectedStatuses = computed(() => contractListFilterValues(query.value.status))
const rowNavigationPending = shallowRef(false)
const listShellRef = useTemplateRef<{ $el: HTMLElement }>('listShellRef')
const returnContextId = shallowRef(isMaterialContractReturnContextId(route.query.nav)
  ? route.query.nav
  : newMaterialContractReturnContextId())
let restoredRoute = ''
const projectReturnTo = computed(() => validateProjectJourneyReturnTo(route.query.returnTo, query.value.origin))
const canCreate = computed(() => (state.value.kind === 'ready' || state.value.kind === 'empty') && (page.value?.capabilities.includes('material-contract:write') ?? false))
const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 48, fixed: 'left' },
  { field: 'name', title: '合同名称', width: 210, fixed: 'left', slot: 'name' },
  { field: 'no', title: '合同编号', width: 150 },
  { field: 'project', title: '项目名称', width: 180, slot: 'project' },
  { field: 'supplier', title: '乙方', width: 180, slot: 'supplier' },
  { field: 'contract', title: '含税合同金额', width: 140, type: 'money', slot: 'contract' },
  { field: 'changed', title: '变更后合同金额', width: 150, type: 'money', slot: 'changed' },
  { field: 'settled', title: '累计结算金额', width: 140, type: 'money', slot: 'settled' },
  { field: 'invoiced', title: '累计收票金额', width: 140, type: 'money', slot: 'invoiced' },
  { field: 'paid', title: '累计支付金额', width: 140, type: 'money', slot: 'paid' },
  { field: 'payable', title: '按结算应付金额', width: 150, type: 'money', slot: 'payable' },
  { field: 'invoicePayable', title: '按收票应付金额', width: 150, type: 'money', slot: 'invoicePayable' },
  { field: 'signDate', title: '签约日期', width: 120, slot: 'signDate' },
  { field: 'status', title: '合同状态', width: 110, customHeader: true, slot: 'status' },
  { field: 'dataOrigin', title: '来源', width: 80, slot: 'origin' },
]
const summaries = computed(() => {
  if (!page.value)
    return []
  return (['real', 'demo'] as const)
    .filter(origin => (!query.value.origin || query.value.origin === origin) && (origin !== 'demo' || visibilityStore.includeDemo))
    .map(origin => ({ origin, label: origin === 'real' ? '正式' : '演示', ...page.value!.summary.origins[origin] }))
})

function relationshipTarget(intent: NavigationIntentDTO) {
  const target = resolveNavigationTarget(intent)
  return target.state === 'resolved' ? target.to : null
}

function unavailableLabel(label: string, intent: NavigationIntentDTO) {
  const target = resolveNavigationTarget(intent)
  return target.state === 'resolved' ? label : `${label}（${target.message}）`
}

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
let listGeneration = 0
let listActive = true
async function loadCurrentQuery() {
  const current = parsedQuery.value.query
  if (!current || !listActive || route.path !== '/contract/material')
    return
  const generation = ++listGeneration
  const signature = JSON.stringify(current)
  await store.loadList(current)
  if (generation !== listGeneration || !listActive || route.path !== '/contract/material'
    || signature !== JSON.stringify(parsedQuery.value.query) || signature !== JSON.stringify(store.listQuery)) {
    return
  }
  const completed = state.value
  if ((completed.kind === 'ready' || completed.kind === 'empty')
    && completed.data.pagination.requestedPage === current.page
    && completed.data.pagination.pageSize === current.pageSize
    && completed.data.pagination.page !== current.page) {
    patchQuery({ page: completed.data.pagination.page })
  }
}
watch(parsedQuery, () => void loadCurrentQuery(), { immediate: true })
function deactivateList() {
  listActive = false
  listGeneration++
}
onDeactivated(deactivateList)
onBeforeUnmount(deactivateList)

function workspaceScrollTop(): number {
  return document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop ?? 0
}

function returnOrigin(row: MaterialContractListPageDTO['items'][number], scrollTop = 0) {
  return createMaterialContractReturnOrigin({
    contextId: returnContextId.value,
    rowIdentity: row.rowKey,
    scrollTop,
    now: Date.now(),
    state: {
      ...materialContractListNavigationStateFromQuery(route.query),
      search: search.value.trim(),
      origin: row.dataOrigin,
    },
  })
}

function link(row: MaterialContractListPageDTO['items'][number]) {
  const origin = returnOrigin(row)
  const target = resolveNavigationTarget(row.navigation, { returnTo: origin.returnTo })
  return target.state === 'resolved' ? target.to : null
}

function captureReturnOrigin(row: MaterialContractListPageDTO['items'][number]) {
  rowNavigationPending.value = true
  try {
    saveMaterialContractReturnOrigin(returnOrigin(row, workspaceScrollTop()))
  }
  catch {
    // 导航不应因浏览器存储不可用而被拦截；无上下文时按安全列表地址降级。
  }
}

async function restoreReturnOrigin() {
  if (route.path !== '/contract/material' || restoredRoute === route.fullPath)
    return
  const currentState = state.value
  if (queryProblem.value || (currentState.kind !== 'ready' && currentState.kind !== 'empty'))
    return
  const fullPath = route.fullPath
  const result = resolveMaterialContractReturnContext({
    returnTo: fullPath,
    contextId: route.query.nav,
    now: Date.now(),
    load: loadMaterialContractReturnOrigin,
  })
  if (!result.origin)
    return
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const root = listShellRef.value?.$el
  if (!root?.isConnected || route.fullPath !== fullPath || state.value !== currentState)
    return
  const anchor = [...root.querySelectorAll<HTMLElement>('[id]')].find(element => element.id === result.origin!.anchorId)
  const focusTarget = anchor ?? root.querySelector<HTMLElement>('#material-contract-list-heading')
  if (!focusTarget)
    return
  const workspace = root.closest<HTMLElement>('[data-shell-workspace]') ?? document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (workspace)
    workspace.scrollTop = result.origin.scrollTop
  focusTarget.focus({ preventScroll: true })
  restoredRoute = fullPath
}

watch(() => [state.value, state.value.kind, route.fullPath], () => void restoreReturnOrigin(), { flush: 'post' })
onMounted(() => void restoreReturnOrigin())
onActivated(() => {
  if (!listActive) {
    listActive = true
    void loadCurrentQuery()
  }
  void restoreReturnOrigin()
})

useTabTitle('材料采购合同')
</script>

<template>
  <ListShell ref="listShellRef" continuous data-testid="material-contract-list">
    <template #heading>
      <TargetCostSourceReturn />
      <h1 id="material-contract-list-heading" tabindex="-1" class="text-14px font-700 text-ink outline-none" title="正式数据与已授权演示数据分源展示；演示数据只读。">
        材料采购合同
      </h1>
      <NuxtLink v-if="projectReturnTo" :to="projectReturnTo" class="inline-flex text-12px font-700 text-brand hover:underline">
        返回项目详情
      </NuxtLink>
    </template>
    <template #actions>
      <div v-if="!queryProblem" class="relative min-w-0 w-60 max-w-full">
        <span class="i-lucide-search pointer-events-none absolute left-2.5 top-1/2 text-14px text-ink-faint -translate-y-1/2" aria-hidden="true" />
        <input v-model="search" type="search" class="field-input h-8 min-w-0 w-full pl-8 text-13px" placeholder="搜索合同名称或编号" aria-label="搜索材料采购合同">
      </div>
      <NuxtLink v-if="canCreate" to="/import/mapping/material-contract" class="btn-secondary min-h-8 text-13px">
        导入采购合同
      </NuxtLink>
      <NuxtLink v-if="canCreate" to="/contract/material/form" class="btn-primary min-h-8 text-13px">
        新建材料采购合同
      </NuxtLink>
    </template>
    <template v-if="!queryProblem" #filters>
      <section class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2" aria-label="材料采购合同筛选">
        <select class="field-input h-8 min-w-0 w-40 max-w-full py-1 text-12px" :value="query.projectId ?? ''" aria-label="筛选项目" @change="patchQuery({ projectId: ($event.target as HTMLSelectElement).value, page: 1 })">
          <option value="">
            全部项目
          </option><option v-for="item in page?.summary.projects ?? []" :key="item.id" :value="item.id">
            {{ item.label }}
          </option>
        </select>
        <select class="field-input h-8 min-w-0 w-40 max-w-full py-1 text-12px" :value="query.supplierId ?? ''" aria-label="筛选分供方" @change="patchQuery({ supplierId: ($event.target as HTMLSelectElement).value, page: 1 })">
          <option value="">
            全部分供方
          </option><option v-for="item in page?.summary.suppliers ?? []" :key="item.id" :value="item.id">
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

    <template v-if="page && !queryProblem" #summary>
      <div v-for="summary in summaries" :key="summary.origin" class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 tabular-nums" :aria-label="`${summary.label}数据汇总`">
        <strong class="font-600 text-ink">{{ summary.label }} · {{ summary.contractCount }} 份</strong>
        <span>变更后合同金额 <strong class="font-600 text-ink">{{ summary.changedAmount == null ? '待核实' : yuan(Number(summary.changedAmount)) }}</strong></span>
        <span>累计收票金额 <strong class="font-600 text-ink">{{ summary.invoicedAmount == null ? '待核实' : yuan(Number(summary.invoicedAmount)) }}</strong></span>
        <span>累计支付金额 <strong class="font-600 text-ink">{{ summary.paidAmount == null ? '待核实' : yuan(Number(summary.paidAmount)) }}</strong></span>
      </div>
    </template>

    <template #table>
      <StatePanel v-if="queryProblem" kind="error" title="材料采购合同查询条件无效" :description="queryProblem.message" action-label="清除无效条件" @action="router.replace({ query: {} })" />
      <div v-else-if="page" class="relative min-w-0" :aria-busy="state.kind === 'loading'">
        <span v-if="state.kind === 'loading'" role="status" class="pointer-events-none absolute right-3 top-1 z-1 rounded-sm bg-panel px-2 py-1 text-12px text-ink-soft">正在更新列表…</span>
        <div v-if="state.kind === 'error' || state.kind === 'unavailable'" class="border-y border-danger/40 bg-danger/5 p-3 text-12px text-danger" role="alert">
          {{ state.problem.message }}；当前保留上一次成功读取的列表。
          <button v-if="state.problem.retryable" type="button" class="ml-2 underline" @click="store.loadList(query)">
            重试
          </button>
        </div>
        <section class="min-w-0" data-testid="material-contract-list-scroll">
          <KitTable
            :columns="columns"
            :data="page.items"
            :loading="false"
            :page="page.pagination"
            :page-size-options="[10, 20, 50, 100]"
            :empty="{
              title: page.empty?.reason === 'no-filter-match' ? '没有符合当前筛选条件的合同' : '暂无材料采购合同',
              description: '可调整筛选条件，或新建正式材料采购合同。',
            }"
            row-key="rowKey"
            @page-change="({ page: nextPage, pageSize: nextSize }) => patchQuery({ page: nextPage, pageSize: nextSize })"
          >
            <template #columnHeader="{ column }">
              <KitColumnHeader :title="column.title" kind="multi-enum" :value="selectedStatuses" :options="statusOptions" @apply="Array.isArray($event) && patchQuery({ status: $event, page: 1 })" />
            </template>
            <template #name="{ row }">
              <NuxtLink
                v-if="link(row)"
                :id="`material-contract-row-${row.rowKey}`"
                :to="link(row)!"
                :title="row.name"
                class="font-700 text-brand hover:underline"
                @click="captureReturnOrigin(row)"
              >
                {{ row.name }}
              </NuxtLink><span v-else>{{ unavailableLabel(row.name, row.navigation) }}</span>
            </template>
            <template #origin="{ row }">
              <span class="chip" :class="row.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">{{ row.dataOrigin === 'demo' ? '演示' : '正式' }}</span>
            </template>
            <template #project="{ row }">
              <NuxtLink v-if="relationshipTarget(row.projectNavigation)" :to="relationshipTarget(row.projectNavigation)!" class="text-brand hover:underline">
                {{ materialContractReferenceLabel(row.project) }}
              </NuxtLink>
              <span v-else>{{ row.project.state === 'resolved' ? unavailableLabel(row.project.label, row.projectNavigation) : materialContractReferenceLabel(row.project) }}</span>
            </template>
            <template #supplier="{ row }">
              <NuxtLink v-if="relationshipTarget(row.supplierNavigation)" :to="relationshipTarget(row.supplierNavigation)!" class="text-brand hover:underline">
                {{ materialContractReferenceLabel(row.supplier) }}
              </NuxtLink>
              <span v-else>{{ row.supplier.state === 'resolved' ? unavailableLabel(row.supplier.label, row.supplierNavigation) : materialContractReferenceLabel(row.supplier) }}</span>
            </template>
            <template #contract="{ row }">
              {{ row.amounts.contract == null ? '待核实' : yuan(Number(row.amounts.contract)) }}
            </template>
            <template #changed="{ row }">
              {{ row.amounts.changed == null ? '待核实' : yuan(Number(row.amounts.changed)) }}
            </template>
            <template #invoiced="{ row }">
              {{ row.amounts.invoiced == null ? '待核实' : yuan(Number(row.amounts.invoiced)) }}
            </template>
            <template #paid="{ row }">
              {{ row.amounts.paid == null ? '待核实' : yuan(Number(row.amounts.paid)) }}
            </template>
            <template #settled="{ row }">
              {{ row.amounts.settled == null ? '待核实' : yuan(Number(row.amounts.settled)) }}
            </template>
            <template #payable="{ row }">
              {{ row.amounts.payable == null ? '待核实' : yuan(Number(row.amounts.payable)) }}
            </template>
            <template #invoicePayable="{ row }">
              {{ row.amounts.invoiced == null || row.amounts.paid == null ? '待核实' : yuan(Number(row.amounts.invoiced) - Number(row.amounts.paid)) }}
            </template>
            <template #signDate="{ row }">
              {{ row.signDate || '未记录' }}
            </template>
            <template #status="{ row }">
              <KitStatusTag :tone="contractStatusTone(row.status)">
                {{ row.status }}
              </KitStatusTag>
            </template>
          </KitTable>
        </section>
      </div>

      <StatePanel v-else-if="state.kind === 'loading' || state.kind === 'idle'" kind="loading" title="正在读取材料采购合同" description="正在从中央读模型加载列表。" />
      <StatePanel v-else-if="state.kind === 'forbidden'" kind="forbidden" :title="readProblemTitle(problem, '无权查看材料采购合同')" :description="state.problem.message" />
      <StatePanel v-else kind="error" title="材料采购合同读取失败" :description="problem?.message ?? '中央列表暂不可用'" :action-label="problem?.retryable ? '重新加载' : ''" @action="store.loadList(query)" />
    </template>
  </ListShell>
</template>
