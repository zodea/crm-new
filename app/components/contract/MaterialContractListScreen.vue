<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { MaterialContractListPageDTO } from '~/lib/material-contract/repository'
import type { ReadState } from '~/types/read-model'
import { useDebounceFn } from '@vueuse/core'
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
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useMaterialContractReadStore } from '~/stores/material-contract-read'

const route = useRoute()
const router = useRouter()
const store = useMaterialContractReadStore()
const visibilityStore = useDataVisibilityStore()
const state = computed(() => store.listState as ReadState<MaterialContractListPageDTO>)
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
const search = ref(query.value.search)
const rowNavigationPending = ref(false)
const returnContextId = ref(isMaterialContractReturnContextId(route.query.nav)
  ? route.query.nav
  : newMaterialContractReturnContextId())
let restoredRoute = ''
const projectReturnTo = computed(() => validateProjectJourneyReturnTo(route.query.returnTo, query.value.origin))
const canCreate = computed(() => page.value?.capabilities.includes('material-contract:write') ?? false)
const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'no', title: '合同编号', width: 150, fixed: 'left' },
  { field: 'name', title: '合同名称', minWidth: 190, fixed: 'left', slot: 'name' },
  { field: 'dataOrigin', title: '来源', width: 80, slot: 'origin' },
  { field: 'project', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'supplier', title: '分供方', minWidth: 170, slot: 'supplier' },
  { field: 'changed', title: '变更后金额', width: 130, type: 'money', slot: 'changed' },
  { field: 'invoiced', title: '累计收票', width: 120, type: 'money', slot: 'invoiced' },
  { field: 'paid', title: '累计支付', width: 120, type: 'money', slot: 'paid' },
  { field: 'status', title: '状态', width: 100 },
]

function patchQuery(patch: Record<string, string | number | null | undefined>) {
  const next = { ...route.query }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '' || (key === 'page' && Number(value) === 1))
      delete next[key]
    else
      next[key] = String(value)
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
watch(parsedQuery, (value) => {
  if (value.query)
    void store.loadList(value.query)
}, { immediate: true })

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
  const target = resolveNavigationTarget(row.navigation)
  if (target.state !== 'resolved')
    return null
  const origin = returnOrigin(row)
  const separator = target.to.includes('?') ? '&' : '?'
  return `${target.to}${separator}returnTo=${encodeURIComponent(origin.returnTo)}`
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
  const result = resolveMaterialContractReturnContext({
    returnTo: route.fullPath,
    contextId: route.query.nav,
    now: Date.now(),
    load: loadMaterialContractReturnOrigin,
  })
  if (!result.origin)
    return
  let anchor: HTMLElement | null = null
  for (let attempt = 0; attempt < 4 && !anchor; attempt += 1) {
    await nextTick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    anchor = document.getElementById(result.origin.anchorId)
  }
  const focusTarget = anchor ?? document.getElementById('material-contract-list-heading')
  if (!focusTarget)
    return
  const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (workspace)
    workspace.scrollTop = result.origin.scrollTop
  focusTarget.focus({ preventScroll: true })
  restoredRoute = route.fullPath
}

watch(() => [state.value.kind, page.value?.items.length, route.fullPath], () => void restoreReturnOrigin(), { flush: 'post' })
onMounted(() => void restoreReturnOrigin())
onActivated(() => void restoreReturnOrigin())

useTabTitle('材料采购合同')
</script>

<template>
  <div class="min-w-0 space-y-3" data-testid="material-contract-list">
    <header class="panel px-4 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="material-contract-list-heading" tabindex="-1" class="text-18px font-850 text-ink outline-none">
            材料采购合同
          </h1><p class="mt-1 text-12px text-ink-soft">
            正式数据与已授权演示数据分源展示；演示数据只读。
          </p>
          <NuxtLink v-if="projectReturnTo" :to="projectReturnTo" class="mt-2 inline-flex text-12px font-700 text-brand hover:underline">
            返回项目详情
          </NuxtLink>
        </div>
        <NuxtLink v-if="canCreate" to="/contract/material/form" class="btn-primary">
          新建材料采购合同
        </NuxtLink>
      </div>
    </header>

    <StatePanel v-if="queryProblem" kind="error" title="材料采购合同查询条件无效" :description="queryProblem.message" action-label="清除无效条件" @action="router.replace({ query: {} })" />

    <section v-else class="panel p-3" aria-label="材料采购合同筛选">
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <input v-model="search" class="field-input" placeholder="搜索合同名称或编号" aria-label="搜索材料采购合同">
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
        <select class="field-input" :value="query.status ?? ''" aria-label="筛选状态" @change="patchQuery({ status: ($event.target as HTMLSelectElement).value, page: 1 })">
          <option value="">
            全部状态
          </option><option v-for="item in page?.summary.statuses ?? []" :key="item.value" :value="item.value">
            {{ item.value }}（{{ item.count }}）
          </option>
        </select>
        <select class="field-input" :value="query.pageSize" aria-label="每页数量" @change="patchQuery({ pageSize: Number(($event.target as HTMLSelectElement).value), page: 1 })">
          <option v-for="size in [10, 20, 50, 100]" :key="size" :value="size">
            每页 {{ size }} 条
          </option>
        </select>
      </div>
    </section>

    <div v-if="!queryProblem && page" class="space-y-3">
      <div v-if="state.kind === 'error'" class="panel border-danger/40 bg-danger/5 p-3 text-12px text-danger" role="alert">
        {{ state.problem.message }}；当前保留上一次成功读取的列表。
        <button v-if="state.problem.retryable" type="button" class="ml-2 underline" @click="store.loadList(query)">
          重试
        </button>
      </div>
      <section class="panel min-w-0 overflow-hidden" data-testid="material-contract-list-scroll">
        <KitTable
          :columns="columns"
          :data="page.items"
          :loading="state.kind === 'loading'"
          :page="page.pagination"
          :page-size-options="[10, 20, 50, 100]"
          :empty="{
            title: page.empty?.reason === 'no-filter-match' ? '没有符合当前筛选条件的合同' : '暂无材料采购合同',
            description: '可调整筛选条件，或新建正式材料采购合同。',
          }"
          row-key="rowKey"
          @page-change="({ page: nextPage, pageSize: nextSize }) => patchQuery({ page: nextPage, pageSize: nextSize })"
        >
          <template #name="{ row }">
            <NuxtLink
              v-if="link(row)"
              :id="`material-contract-row-${row.rowKey}`"
              :to="link(row)!"
              class="font-700 text-brand hover:underline"
              @click="captureReturnOrigin(row)"
            >
              {{ row.name }}
            </NuxtLink><span v-else>{{ row.name }}</span>
          </template>
          <template #origin="{ row }">
            <span class="chip" :class="row.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">{{ row.dataOrigin === 'demo' ? '演示' : '正式' }}</span>
          </template>
          <template #project="{ row }">
            {{ materialContractReferenceLabel(row.project) }}
          </template>
          <template #supplier="{ row }">
            {{ materialContractReferenceLabel(row.supplier) }}
          </template>
          <template #changed="{ row }">
            {{ yuan(Number(row.amounts.changed)) }}
          </template>
          <template #invoiced="{ row }">
            {{ yuan(Number(row.amounts.invoiced)) }}
          </template>
          <template #paid="{ row }">
            {{ yuan(Number(row.amounts.paid)) }}
          </template>
        </KitTable>
      </section>
    </div>

    <StatePanel v-else-if="!queryProblem && (state.kind === 'loading' || state.kind === 'idle')" kind="loading" title="正在读取材料采购合同" description="正在从中央读模型加载列表。" />
    <StatePanel v-else-if="!queryProblem && state.kind === 'forbidden'" kind="forbidden" title="无权查看材料采购合同" :description="state.problem.message" />
    <StatePanel v-else-if="!queryProblem" kind="error" title="材料采购合同读取失败" :description="state.kind === 'error' ? state.problem.message : '中央列表暂不可用'" action-label="重新加载" @action="store.loadList(query)" />
  </div>
</template>
