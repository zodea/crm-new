<script setup lang="ts">
import type { CrewListPageDTO, WorkerListPageDTO } from '~/lib/crew-worker/repository'
import type { KitTableColumn } from '~/lib/kit/table'
import type { DataOriginDTO, EntityRefDTO, NavigationIntentDTO } from '~/types/read-model'
import { useDebounceFn } from '@vueuse/core'
import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, shallowRef, watch } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { readProblemTitle } from '~/lib/read-model/state'
import { enumSelectionFromQuery, serializeEnumSelection } from '~/lib/util/enum-selection'
import { useCrewWorkerCommandStore } from '~/stores/crew-worker-command'
import { useCrewWorkerReadStore } from '~/stores/crew-worker-read'

const props = defineProps<{ kind: 'crew' | 'worker' }>()
const route = useRoute()
const router = useRouter()
const store = useCrewWorkerReadStore()
const commandStore = useCrewWorkerCommandStore()
const visibility = useDataVisibilityStore()
const viewActive = shallowRef(true)
function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function queryPage(value: unknown): number {
  const parsed = Number.parseInt(queryText(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}
function queryPageSize(value: unknown): 10 | 20 | 50 | 100 {
  const parsed = Number.parseInt(queryText(value), 10)
  return [10, 20, 50, 100].includes(parsed) ? parsed as 10 | 20 | 50 | 100 : 20
}
const search = shallowRef(queryText(route.query.search))
const trade = shallowRef(enumSelectionFromQuery(route.query.trade))
const status = shallowRef(enumSelectionFromQuery(route.query.status))
const initialSort = queryText(route.query.sort)
const sort = shallowRef<'updated-desc' | 'name-asc' | 'name-desc'>(['name-asc', 'name-desc'].includes(initialSort) ? initialSort as 'name-asc' | 'name-desc' : 'updated-desc')
const page = shallowRef(queryPage(route.query.page))
const pageSize = shallowRef<10 | 20 | 50 | 100>(queryPageSize(route.query.pageSize))

interface CentralRowBase {
  id: string
  identity: string
  name: string
  dataOrigin: DataOriginDTO
  intent: NavigationIntentDTO
  trade: string
  status: string
  updatedAt: string
}

interface CrewCentralRow extends CentralRowBase {
  kind: 'crew'
  contactName: string
  contactPhone: string
  memberCount: number
  activeMemberCount: number
  projectCount: number | null
}

interface WorkerCentralRow extends CentralRowBase {
  kind: 'worker'
  crew: (EntityRefDTO & { entity: 'crew' }) | null
  crewNavigation: NavigationIntentDTO | null
  project: (EntityRefDTO & { entity: 'project' }) | null
  projectNavigation: NavigationIntentDTO | null
  phone: string
  projectStatus: string
  safetyEducation: boolean
}

type CentralRow = CrewCentralRow | WorkerCentralRow

const state = computed(() => props.kind === 'crew' ? store.crewListState : store.workerListState)
const readPage = computed<CrewListPageDTO | WorkerListPageDTO | null>(() => {
  const value = state.value
  if (value.kind === 'ready' || value.kind === 'empty')
    return value.data
  if (value.kind === 'loading' || (value.kind === 'error' || value.kind === 'unavailable'))
    return value.previous
  return null
})
const loading = computed(() => state.value.kind === 'loading')
const canCreate = computed(() => viewActive.value && (state.value.kind === 'ready' || state.value.kind === 'empty') && (readPage.value?.capabilities.includes(`${props.kind}:write`) ?? false))
const initialLoading = computed(() => state.value.kind === 'idle' || (state.value.kind === 'loading' && !readPage.value))
const problem = computed(() => 'problem' in state.value ? state.value.problem : null)
const rows = computed<CentralRow[]>(() => props.kind === 'crew'
  ? ((readPage.value as CrewListPageDTO | null)?.items ?? []).map(item => ({
      id: item.crew.id,
      kind: 'crew' as const,
      identity: `${item.dataOrigin}:${item.crew.id}`,
      name: item.crew.label,
      dataOrigin: item.dataOrigin,
      intent: item.navigation,
      trade: item.trade,
      contactName: item.contactName,
      contactPhone: item.contactPhone,
      memberCount: item.memberCount,
      activeMemberCount: item.activeMemberCount,
      projectCount: item.projectCount,
      status: item.status,
      updatedAt: item.updatedAt,
    }))
  : ((readPage.value as WorkerListPageDTO | null)?.items ?? []).map(item => ({
      id: item.worker.id,
      kind: 'worker' as const,
      identity: `${item.dataOrigin}:${item.worker.id}`,
      name: item.worker.label,
      dataOrigin: item.dataOrigin,
      intent: item.navigation,
      trade: item.trade,
      status: item.status,
      updatedAt: item.updatedAt,
      crew: item.crew,
      crewNavigation: item.crewNavigation,
      project: item.currentProject,
      projectNavigation: item.projectNavigation,
      phone: item.phone,
      projectStatus: item.projectStatus,
      safetyEducation: item.safetyEducation,
    })))
const columns = computed<KitTableColumn[]>(() => props.kind === 'crew'
  ? [
      { title: '#', type: 'seq', fixed: 'left' },
      { field: 'name', title: '班组名称', minWidth: 180, fixed: 'left', slot: 'name' },
      { field: 'trade', title: '主工种', width: 120 },
      { field: 'contactName', title: '负责人', width: 110 },
      { field: 'contactPhone', title: '联系电话', width: 130 },
      { field: 'memberCount', title: '成员', width: 80, align: 'right' },
      { field: 'activeMemberCount', title: '在场', width: 80, align: 'right' },
      { field: 'projectCount', title: '关联项目', width: 95, align: 'right' },
      { field: 'status', title: '状态', width: 100 },
      { title: '操作', type: 'action', width: 80 },
    ]
  : [
      { title: '#', type: 'seq', fixed: 'left' },
      { field: 'name', title: '工人姓名', minWidth: 150, fixed: 'left', slot: 'name' },
      { field: 'trade', title: '工种', width: 105 },
      { field: 'crew', title: '所属班组', minWidth: 150, slot: 'crew' },
      { field: 'project', title: '当前项目', minWidth: 170, slot: 'project' },
      { field: 'phone', title: '联系电话', width: 130 },
      { field: 'projectStatus', title: '项目状态', width: 110 },
      { field: 'safetyEducation', title: '安全教育', width: 95, slot: 'safety' },
      { field: 'status', title: '档案状态', width: 100 },
      { title: '操作', type: 'action', width: 80 },
    ])
const summary = computed<Record<string, string | number>>(() => {
  if (props.kind === 'crew') {
    const data = readPage.value as CrewListPageDTO | null
    const result: Record<string, string | number> = { 正式班组: `${data?.summary.origins.real.crewCount ?? 0} 个`, 测试班组: `${visibility.includeDemo ? data?.summary.origins.demo.crewCount ?? 0 : 0} 个` }
    return result
  }
  const data = readPage.value as WorkerListPageDTO | null
  const result: Record<string, string | number> = { 正式工人: `${data?.summary.origins.real.workerCount ?? 0} 人`, 在场工人: `${data?.summary.origins.real.activeWorkerCount ?? 0} 人`, 测试工人: `${visibility.includeDemo ? data?.summary.origins.demo.workerCount ?? 0 : 0} 人` }
  return result
})
const tradeOptions = computed(() => (readPage.value?.summary.trades ?? []).map(item => ({ key: item.value, label: `${item.label}（${item.count}）` })))

let listLoadTicket = 0
function invalidateLoad() {
  listLoadTicket++
}
bindReadAuthority(invalidateLoad)
onDeactivated(() => {
  viewActive.value = false
  invalidateLoad()
})
onScopeDispose(() => {
  viewActive.value = false
  invalidateLoad()
})
function currentLoadScope() {
  return JSON.stringify([props.kind, route.path, visibility.includeDemo, search.value, trade.value, status.value, sort.value, page.value, pageSize.value])
}

async function load() {
  if (!viewActive.value)
    return
  const ticket = ++listLoadTicket
  const scope = currentLoadScope()
  const requestedPage = page.value
  const requestedSize = pageSize.value
  if (props.kind === 'crew') {
    await store.loadCrewList({ includeDemo: visibility.includeDemo, search: search.value, trade: trade.value, status: status.value, sort: sort.value, page: page.value, pageSize: pageSize.value })
  }
  else {
    await store.loadWorkerList({ includeDemo: visibility.includeDemo, search: search.value, trade: trade.value, crewId: null, projectStatus: null, status: status.value, sort: sort.value, page: page.value, pageSize: pageSize.value })
  }
  if (!viewActive.value || ticket !== listLoadTicket || currentLoadScope() !== scope || (state.value.kind !== 'ready' && state.value.kind !== 'empty'))
    return
  const pagination = readPage.value?.pagination
  if (!pagination || pagination.requestedPage !== requestedPage || pagination.pageSize !== requestedSize)
    return
  if (pagination.page !== requestedPage) {
    page.value = pagination.page
    const query = { ...route.query }
    if (pagination.page === 1)
      delete query.page
    else
      query.page = String(pagination.page)
    await router.replace({ query })
  }
}
const debouncedLoad = useDebounceFn(() => {
  page.value = 1
  void load()
}, 180)
function clearFilters() {
  search.value = ''
  trade.value = []
  status.value = []
  sort.value = 'updated-desc'
  page.value = 1
}
function rowReturnTo(row: CentralRow): string {
  const query = new URLSearchParams()
  if (search.value)
    query.set('search', search.value)
  if (trade.value.length)
    query.set('trade', serializeEnumSelection(trade.value))
  if (status.value.length)
    query.set('status', serializeEnumSelection(status.value))
  if (sort.value !== 'updated-desc')
    query.set('sort', sort.value)
  if (page.value !== 1)
    query.set('page', String(page.value))
  if (pageSize.value !== 20)
    query.set('pageSize', String(pageSize.value))
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return `/base/${props.kind}${suffix}#${props.kind}-row-${encodeURIComponent(row.identity)}`
}
function rowTarget(row: CentralRow): string | null {
  const resolution = resolveNavigationTarget(row.intent, { returnTo: rowReturnTo(row) })
  return resolution.state === 'resolved' ? resolution.to : null
}
watch([search, trade, status, sort], debouncedLoad)
watch(() => visibility.includeDemo, () => {
  page.value = 1
  void load()
})
watch(() => commandStore.latestWrite, () => void load(), { deep: true })
watch(() => props.kind, () => void load())
onMounted(() => void load())
onActivated(() => {
  viewActive.value = true
  void load()
})
</script>

<template>
  <div class="grid min-w-0 gap-3">
    <StatePanel v-if="initialLoading" kind="loading" :title="readProblemTitle(problem, `正在加载${kind === 'crew' ? '班组' : '工人'}资料库`)" />
    <StatePanel v-else-if="problem" :kind="['forbidden', 'unauthenticated'].includes(problem.code) ? 'forbidden' : 'error'" :title="readProblemTitle(problem, `${kind === 'crew' ? '班组' : '工人'}列表加载失败`)" :description="problem.message" :action-label="problem.retryable ? '重新加载' : ''" :compact="Boolean(readPage)" @action="load" />
    <ListShell v-if="!initialLoading && (!problem || readPage)" :summary="summary">
      <template #toolbar>
        <section class="panel flex min-w-0 flex-wrap items-center gap-2 p-2.5">
          <div class="mr-auto">
            <h2 class="text-14px font-800 text-ink">
              {{ kind === 'crew' ? '班组资料库' : '工人资料库' }}
            </h2>
            <p class="text-11px text-ink-soft">
              共 {{ readPage?.pagination.total ?? 0 }} {{ kind === 'crew' ? '个班组' : '名工人' }}
            </p>
          </div>
          <SearchInput v-model="search" :placeholder="kind === 'crew' ? '搜索班组、负责人…' : '搜索姓名、手机号、证件号…'" :width="230" />
          <KitMultiSelectFilter v-model="trade" label="工种" :options="tradeOptions" :min-width="135" />
          <SelectFilter v-model="sort" label="排序" :options="[{ key: 'updated-desc', label: '最近更新' }, { key: 'name-asc', label: '名称升序' }, { key: 'name-desc', label: '名称降序' }]" :min-width="125" />
          <button type="button" class="btn-secondary" :disabled="loading" @click="load">
            <span class="i-lucide-refresh-cw mr-1" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />刷新
          </button>
          <NuxtLink v-if="canCreate" :to="`/base/${kind}/form`" class="btn-primary">
            <span class="i-lucide-plus mr-1" aria-hidden="true" />新增{{ kind === 'crew' ? '班组' : '工人' }}
          </NuxtLink>
        </section>
      </template>
      <template #table>
        <div :data-ui="`${kind}-central-list-table`" class="min-w-0 max-w-full" :aria-busy="loading">
          <KitTable :columns="columns" :data="rows" :loading="loading && !readPage" :page="{ page, pageSize, total: readPage?.pagination.total ?? 0 }" :page-size-options="[10, 20, 50, 100]" :empty="{ title: search || trade.length || status.length ? '没有符合条件的记录' : `还没有${kind === 'crew' ? '班组' : '工人'}档案`, description: '可调整筛选或新建正式档案。', actionLabel: search || trade.length || status.length ? '清除筛选' : canCreate ? `新建${kind === 'crew' ? '班组' : '工人'}` : '' }" row-key="identity" @empty-action="search || trade.length || status.length ? clearFilters() : canCreate && navigateTo(`/base/${kind}/form`)" @page-change="({ page: nextPage, pageSize: nextSize }) => { page = nextPage; pageSize = nextSize as 10 | 20 | 50 | 100; load() }">
            <template #name="{ row }">
              <div :id="`${kind}-row-${row.identity}`">
                <EntityLink :id="row.id" :type="kind" :label="row.name" :intent="row.intent" :return-to="rowReturnTo(row)" /><span class="ml-1 text-10px text-ink-faint">{{ row.dataOrigin === 'demo' ? '测试' : '正式' }}</span>
              </div>
            </template>
            <template #crew="{ row }">
              <EntityLink v-if="row.kind === 'worker'" :id="row.crew?.state === 'resolved' ? row.crew.id : null" type="crew" :label="row.crew?.state === 'resolved' ? row.crew.label : null" :intent="row.crewNavigation ?? undefined" :return-to="rowReturnTo(row)" />
            </template>
            <template #project="{ row }">
              <EntityLink v-if="row.kind === 'worker'" :id="row.project?.state === 'resolved' ? row.project.id : null" type="project" :label="row.project?.state === 'resolved' ? row.project.label : null" :intent="row.projectNavigation ?? undefined" :return-to="rowReturnTo(row)" />
            </template>
            <template #safety="{ row }">
              <span v-if="row.kind === 'worker'" :class="row.safetyEducation ? 'chip chip-ok' : 'chip chip-warn'">{{ row.safetyEducation ? '已完成' : '未记录' }}</span>
            </template>
            <template #action="{ row }">
              <NuxtLink v-if="rowTarget(row)" :to="rowTarget(row)!" class="icon-btn" :aria-label="`查看${row.name}详情`">
                <span class="i-lucide-file-text text-14px" aria-hidden="true" />
              </NuxtLink>
              <span v-else class="text-ink-faint" aria-hidden="true">—</span>
            </template>
          </KitTable>
        </div>
      </template>
    </ListShell>
  </div>
</template>
