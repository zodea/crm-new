<script setup lang="ts">
import type { AuxiliaryContractDTO, AuxiliaryContractKind } from '~/lib/auxiliary-contract/contract'
import { useMutationObserver } from '@vueuse/core'
import { AUXILIARY_CATEGORIES, AUXILIARY_LABELS, auxiliaryListPath } from '~/lib/auxiliary-contract/contract'
import { validateAuxiliaryReturnTo } from '~/lib/auxiliary-contract/navigation'
import { auxiliaryColumns, auxiliaryMoney, auxiliaryTableRow } from '~/lib/auxiliary-contract/presentation'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ kind: AuxiliaryContractKind }>()
const listRoot = useTemplateRef<HTMLElement>('listRoot')
let pendingRestore = false
const route = useRoute()
const repository = useNuxtApp().$repositories.auxiliaryContracts
const { data: page, shellState, problem, load } = useAuxiliaryContractRead(() => repository.list({ ...route.query, kind: props.kind }), data => data.empty ? { kind: 'empty', data, empty: data.empty } : { kind: 'ready', data })
const search = ref(String(route.query.search ?? ''))
const category = computed({ get: () => String(route.query.category ?? 'all'), set: value => void filter({ category: value === 'all' ? undefined : value }) })
const status = computed({ get: () => String(route.query.status ?? 'all'), set: value => void filter({ status: value === 'all' ? undefined : value }) })
const project = computed({ get: () => String(route.query.projectId ?? route.query.project ?? ''), set: value => void filter({ projectId: value || undefined, project: undefined }) })
const fetchProjects = async (keyword: string) => (page.value?.projectOptions ?? []).filter(row => row.label.includes(keyword))
const categories = computed(() => [{ key: 'all', label: '全部类别' }, ...AUXILIARY_CATEGORIES[props.kind].map(value => ({ key: value, label: value }))])
const statuses = ['草稿', '审批中', '已签订', '履约中', '已结算', '已结清'].map(value => ({ key: value, label: value }))
const columns = computed(() => auxiliaryColumns(props.kind))
const rows = computed(() => page.value?.items.map(auxiliaryTableRow) ?? [])
const canWrite = computed(() => page.value?.capabilities.includes('auxiliary-contract:write') ?? false)
const hasFilters = computed(() => ['search', 'category', 'status', 'projectId', 'supplierId', 'project', 'supplier'].some(key => route.query[key]))
const empty = computed(() => ({ title: hasFilters.value ? '没有符合条件的合同' : `暂无${AUXILIARY_LABELS[props.kind]}`, description: hasFilters.value ? '请调整或清除筛选。' : '当前范围内还没有合同。', actionLabel: hasFilters.value ? '清除筛选' : '' }))
async function filter(patch: Record<string, string | undefined>) {
  await navigateTo({ path: route.path, query: { ...route.query, ...patch, page: undefined } }, { replace: true })
}
function clearFilters() {
  void navigateTo({ path: route.path, query: { returnTo: route.query.returnTo } }, { replace: true })
  search.value = ''
}
function returnTo(id: string) {
  return `${route.fullPath.split('#')[0]}#aux-row-${id}`
}
function target(row: AuxiliaryContractDTO) {
  const result = resolveNavigationTarget(row.navigation, { returnTo: returnTo(row.id) })
  return result.state === 'resolved' ? result.to : undefined
}
function remember(id: string) {
  const container = document.querySelector<HTMLElement>('[data-shell-workspace]') ?? document.scrollingElement
  sessionStorage.setItem(`auxiliary-scroll:${returnTo(id)}`, String(container?.scrollTop ?? 0))
}
async function restore() {
  await nextTick()
  if (!pendingRestore || route.path !== auxiliaryListPath(props.kind) || shellState.value !== 'ready')
    return
  const id = route.hash.slice(1)
  if (!id.startsWith('aux-row-'))
    return
  const element = document.getElementById(id)
  if (!element || !listRoot.value?.contains(element))
    return
  const saved = sessionStorage.getItem(`auxiliary-scroll:${route.fullPath}`)
  const container = document.querySelector<HTMLElement>('[data-shell-workspace]') ?? document.scrollingElement
  if (saved !== null && container)
    container.scrollTop = Number(saved) || 0
  else element.scrollIntoView({ block: 'nearest' })
  element.focus({ preventScroll: true })
  pendingRestore = false
}
// Vxe renders rows after its own asynchronous layout; restore when the actual anchor exists.
useMutationObserver(listRoot, () => void restore(), { childList: true, subtree: true })
async function refresh() {
  if (route.path !== auxiliaryListPath(props.kind))
    return
  pendingRestore = true
  await load()
  await restore()
}
watch(() => route.fullPath, () => {
  search.value = String(route.query.search ?? '')
  void refresh()
}, { immediate: true })
onActivated(() => void refresh())
useTabTitle(() => AUXILIARY_LABELS[props.kind])
</script>

<template>
  <div ref="listRoot" class="flex min-w-0 flex-col gap-3" data-testid="auxiliary-list">
    <header class="panel flex min-w-0 flex-wrap items-center gap-2 p-3">
      <h1 class="m-0 mr-auto text-15px font-800">
        {{ AUXILIARY_LABELS[kind] }}
      </h1>
      <SelectFilter v-model="category" :options="categories" label="类别" class="lg:hidden" />
      <SelectFilter v-model="status" :options="[{ key: 'all', label: '全部状态' }, ...statuses]" label="状态" />
      <LookupSelect v-if="kind === 'other_expense'" v-model="project" :fetch="fetchProjects" placeholder="筛选项目" class="w-48 max-w-full" />
      <form class="flex min-w-0 flex-wrap gap-2" @submit.prevent="filter({ search: search || undefined })">
        <input v-model="search" class="field-input min-w-0 max-w-full" placeholder="搜索合同名称 / 编号 / 对方单位" aria-label="搜索合同名称 / 编号 / 对方单位">
        <KitButton type="submit">
          搜索
        </KitButton>
      </form>
      <KitButton aria-label="刷新合同列表" @click="refresh">
        刷新
      </KitButton>
      <KitButton v-if="canWrite" variant="primary" @click="navigateTo(`${auxiliaryListPath(kind)}/form?returnTo=${encodeURIComponent(route.fullPath)}`)">
        新建合同
      </KitButton>
    </header>
    <div v-if="hasFilters" class="flex flex-wrap items-center gap-2 text-12px">
      <span>当前筛选：{{ route.query.projectId || route.query.project ? '限定项目 · ' : '' }}{{ route.query.supplierId || route.query.supplier ? '限定分供方 · ' : '' }}{{ route.query.search || route.query.category || route.query.status || '来源范围' }}</span>
      <KitButton @click="clearFilters">
        清除筛选
      </KitButton>
    </div>
    <NuxtLink v-if="validateAuxiliaryReturnTo(route.query.returnTo)" :to="validateAuxiliaryReturnTo(route.query.returnTo)!" class="text-13px text-brand">
      返回来源
    </NuxtLink>
    <StatePanel v-if="problem" :kind="shellState === 'forbidden' ? 'forbidden' : 'error'" :title="problem.message" :action-label="problem.retryable ? '重新加载' : ''" @action="refresh" />
    <div v-else class="grid min-w-0 gap-3 lg:grid-cols-[150px_minmax(0,1fr)]">
      <aside class="panel hidden min-w-0 p-2 lg:block" aria-label="合同类别">
        <p class="m-0 border-b border-line px-2 py-3 text-12px font-700">
          合同分类
        </p>
        <button v-for="option in categories" :key="option.key" type="button" class="mt-1 block w-full cursor-pointer border-0 rounded px-3 py-2 text-left text-13px" :class="category === option.key ? 'bg-brand-soft font-700 text-brand' : 'bg-transparent text-ink-soft hover:bg-surface-2'" :aria-pressed="category === option.key" @click="category = option.key">
          {{ option.label }}
        </button>
      </aside>
      <div class="min-w-0">
        <KitTable :columns="columns" :data="rows" :loading="shellState === 'loading'" :page="page?.pagination ?? { page: 1, pageSize: 20, total: 0 }" :empty="empty" @empty-action="clearFilters" @page-change="navigateTo({ path: route.path, query: { ...route.query, page: $event.page, pageSize: $event.pageSize } }, { replace: true })">
          <template #name="{ row }">
            <NuxtLink :id="`aux-row-${row.id}`" :to="target(row.source)" class="cell--link" @click="remember(row.id)">
              {{ row.name }}
            </NuxtLink>
          </template>
          <template #action="{ row }">
            <RowActionMenu :items="[{ key: 'view', label: '查看详情', icon: 'i-lucide-eye' }]" :label="`${row.name}操作`" @select="navigateTo(target(row.source)!)" />
          </template>
        </KitTable>
        <div class="flex flex-wrap justify-end gap-4 border border-line bg-surface-2 px-3 py-2 text-12px">
          <span>当前筛选 · 正式合同 {{ page?.summary.real.count ?? 0 }} 份</span><span>合同金额合计 <strong class="font-mono">{{ auxiliaryMoney(page?.summary.real.amount ?? null) }}</strong></span>
        </div>
      </div>
    </div>
  </div>
</template>
