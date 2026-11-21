<script setup lang="ts">
import type { CustomerListPageDTO, CustomerListQueryDTO } from '~/lib/customer/repository'
import type { MasterDataFilterValue, MasterDataListFilterField, MasterDataListSort } from '~/lib/master-data/list'
import { useDebounceFn } from '@vueuse/core'
import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, shallowRef, watch } from 'vue'
import EntityPendingRecovery from '~/components/shared/EntityPendingRecovery.vue'
import { MASTER_DATA_LIST_PROFILES, masterDataStatusLabel } from '~/lib/master-data/list'
import { readProblemTitle } from '~/lib/read-model/state'
import { normalizeEnumSelection } from '~/lib/util/enum-selection'
import { maskIdentifier, maskPhone } from '~/lib/util/privacy'
import { useCustomerCommandStore } from '~/stores/customer-command'
import { useCustomerReadStore } from '~/stores/customer-read'

const readStore = useCustomerReadStore()
const commandStore = useCustomerCommandStore()
const visibility = useDataVisibilityStore()
const route = useRoute()
const router = useRouter()
const { error } = useKitUI()
const search = shallowRef('')
const sort = shallowRef<MasterDataListSort>('updated-desc')
const filters = shallowRef<Partial<Record<MasterDataListFilterField, MasterDataFilterValue>>>({ status: [] })
const page = shallowRef(1)
const pageSize = shallowRef(10)
const profile = MASTER_DATA_LIST_PROFILES.customer
const listRoot = shallowRef<HTMLElement | null>(null)

const readPage = computed<CustomerListPageDTO | null>(() => {
  const state = readStore.listState
  if (state.kind === 'ready' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || (state.kind === 'error' || state.kind === 'unavailable'))
    return state.previous
  return null
})
const rows = computed(() => (readPage.value?.items ?? []).map(item => ({
  id: item.customer.id,
  identity: `${item.dataOrigin}:${item.customer.id}`,
  name: item.customer.label,
  aliases: item.aliases,
  taxNo: item.taxNo,
  contact: item.contact,
  contactPhone: item.contactPhone,
  status: item.status,
  dataOrigin: item.dataOrigin,
  navigation: item.navigation,
})))
const loading = computed(() => readStore.listState.kind === 'loading')
const problem = computed(() => ['forbidden', 'unauthenticated', 'not-found', 'mismatch', 'unavailable', 'error'].includes(readStore.listState.kind)
  && 'problem' in readStore.listState
  ? readStore.listState.problem
  : null)
const statusOptions = computed(() => ({
  status: [
    ...(readPage.value?.summary.statuses ?? []).map(item => ({ key: item.value, label: `${masterDataStatusLabel(item.value)}（${item.count}）` })),
  ],
}))
const summary = computed(() => ({
  正式客户: readPage.value?.summary.origins.real.customerCount ?? 0,
  ...(visibility.includeDemo ? { 测试客户: readPage.value?.summary.origins.demo.customerCount ?? 0 } : {}),
}))
const hasFilters = computed(() => Boolean(search.value || normalizeEnumSelection(filters.value.status).length))
const empty = computed(() => hasFilters.value
  ? { title: '没有符合条件的客户', description: '可清除搜索或档案状态后查看全部客户。', actionLabel: '清除筛选' }
  : { title: '还没有客户档案', description: '正式工作区暂无客户；测试数据默认隐藏。', actionLabel: '新建客户' })

const returnContext = useCustomerListReturnContext({
  root: () => listRoot.value,
  isReady: () => ['ready', 'empty'].includes(readStore.listState.kind),
  readState: () => ({
    search: search.value,
    status: filters.value.status ?? [],
    sort: sort.value,
    page: page.value,
    pageSize: pageSize.value as 10 | 20 | 50 | 100,
  }),
  applyState: (state) => {
    search.value = state.search
    filters.value = { status: state.status }
    sort.value = state.sort
    page.value = state.page
    pageSize.value = state.pageSize
  },
  fallbackFocus: () => listRoot.value?.querySelector<HTMLElement>('[data-customer-list-return-fallback]') ?? null,
})

function currentQuery(): CustomerListQueryDTO {
  return {
    includeDemo: visibility.includeDemo,
    search: search.value,
    status: normalizeEnumSelection(filters.value.status),
    sort: sort.value,
    page: page.value,
    pageSize: pageSize.value as CustomerListQueryDTO['pageSize'],
  }
}

let latestViewLoad = 0
let viewActive = true
async function load() {
  const request = ++latestViewLoad
  const query = currentQuery()
  const path = route.fullPath
  await readStore.loadList(query)
  if (!viewActive || request !== latestViewLoad || path !== route.fullPath || JSON.stringify(currentQuery()) !== JSON.stringify(query))
    return
  const state = readStore.listState
  if (state.kind !== 'ready' && state.kind !== 'empty')
    return
  const pagination = state.data.pagination
  if (pagination.requestedPage !== query.page || pagination.pageSize !== query.pageSize)
    return
  if (pagination.page !== page.value) {
    page.value = pagination.page
    await router.replace({ query: { ...route.query, page: String(pagination.page) } })
    if (!viewActive || request !== latestViewLoad)
      return
  }
  await returnContext.restore()
}

const debouncedLoad = useDebounceFn(() => {
  page.value = 1
  void load()
}, 180)

function detailTo(row: typeof rows.value[number]) {
  const returnTo = returnContext.returnToFor(row.identity)
  return `/base/customer/${encodeURIComponent(row.id)}?origin=${row.dataOrigin}&returnTo=${encodeURIComponent(returnTo)}&returnContext=${encodeURIComponent(returnContext.contextId)}`
}

function createCustomer() {
  if (!readPage.value?.capabilities.includes('customer:write')) {
    error('无客户写入权限')
    return
  }
  void navigateTo('/base/customer/form')
}

function emptyAction() {
  if (hasFilters.value) {
    search.value = ''
    filters.value = { status: [] }
    sort.value = 'updated-desc'
    page.value = 1
  }
  else {
    createCustomer()
  }
}

watch([search, sort, filters], debouncedLoad, { deep: true })
watch(() => visibility.includeDemo, () => {
  page.value = 1
  void load()
})
watch(() => commandStore.latestWrite, () => void load(), { deep: true })
onMounted(() => void load())
onActivated(() => {
  viewActive = true
  void load()
})
function deactivateView() {
  viewActive = false
  latestViewLoad++
}
onDeactivated(deactivateView)
onScopeDispose(deactivateView)
</script>

<template>
  <div ref="listRoot" class="grid min-w-0 gap-3">
    <EntityPendingRecovery
      v-if="readPage?.capabilities.includes('customer:original:write')"
      entity-label="客户"
      description="刷新前的保存结果还未确认。先核对原提交，再填写新的客户资料。"
      :load-pending-forms="commandStore.pendingForms"
    />
    <StatePanel
      v-if="problem"
      :kind="['forbidden', 'unauthenticated'].includes(problem.code) ? 'forbidden' : 'error'"
      :title="readProblemTitle(problem, '客户列表加载失败')"
      :description="problem.message"
      :action-label="problem.retryable ? '重新加载' : ''"
      :compact="Boolean(readPage)"
      @action="load"
    />
    <ListShell v-if="!problem || readPage" :summary="summary">
      <template #toolbar>
        <MasterDataListToolbar
          v-model:search="search"
          v-model:filters="filters"
          v-model:sort="sort"
          data-customer-list-return-fallback
          tabindex="-1"
          entity-label="客户"
          list-label="客户档案"
          :loading="loading"
          :total="readPage?.pagination.total ?? 0"
          :visible="readPage?.pagination.total ?? 0"
          :search-placeholder="profile.searchPlaceholder"
          :filter-definitions="profile.filters"
          :filter-options="statusOptions"
          :sort-options="[
            { key: 'updated-desc', label: '最近更新' },
            { key: 'name-asc', label: '名称升序' },
            { key: 'name-desc', label: '名称降序' },
          ]"
          @refresh="load"
          @create="createCustomer"
        />
      </template>
      <template #table>
        <div data-ui="customer-list-table" class="min-w-0 max-w-full" :aria-busy="loading">
          <KitTable
            :columns="profile.columns"
            :data="rows"
            :loading="loading && !readPage"
            :page="{ page, pageSize, total: readPage?.pagination.total ?? 0 }"
            :page-size-options="[10, 20, 50, 100]"
            :empty="empty"
            row-key="identity"
            @empty-action="emptyAction"
            @page-change="({ page: nextPage, pageSize: nextSize }) => { page = nextPage; pageSize = nextSize; load() }"
          >
            <template #name="{ row }">
              <div :id="returnContext.anchorId(row.identity)">
                <NuxtLink :to="detailTo(row)" class="cell--link" @click="returnContext.capture(row.identity)">
                  {{ row.name }}
                </NuxtLink>
                <span class="ml-1 text-10px text-ink-faint">{{ row.dataOrigin === 'demo' ? '测试' : '正式' }}</span>
              </div>
            </template>
            <template #aliases="{ row }">
              {{ row.aliases.join('、') || '—' }}
            </template>
            <template #identifier="{ row }">
              <span class="font-mono">{{ maskIdentifier(row.taxNo) || '—' }}</span>
            </template>
            <template #phone="{ row }">
              <span class="font-mono">{{ maskPhone(row.contactPhone) || '—' }}</span>
            </template>
            <template #status="{ row }">
              <span :class="row.status === 'active' ? 'chip chip-ok' : 'chip chip-warn'">{{ masterDataStatusLabel(row.status) }}</span>
            </template>
            <template #action="{ row }">
              <div class="flex justify-end gap-1">
                <NuxtLink :to="detailTo(row)" class="icon-btn" :aria-label="`查看${row.name}客户详情`" @click="returnContext.capture(row.identity)">
                  <span class="i-lucide-file-text text-14px" aria-hidden="true" />
                </NuxtLink>
                <span class="icon-btn cursor-not-allowed opacity-40" title="请从客户详情显式进入编辑" aria-label="请从客户详情显式进入编辑">
                  <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
                </span>
              </div>
            </template>
          </KitTable>
        </div>
      </template>
    </ListShell>
    <CustomerDeletedList v-if="readPage?.capabilities.includes('customer:lifecycle:write')" />
  </div>
</template>
