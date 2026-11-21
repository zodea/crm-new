<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { ReceiptPage } from '~/lib/receipt/contract'
import type { ProblemDTO } from '~/types/read-model'
import { useDebounceFn } from '@vueuse/core'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue'
import ListShell from '~/components/ui/ListShell.vue'
import { financeStatusLabel, financeStatusTone } from '~/lib/finance/status'
import { receiptProblemFromUnknown } from '~/lib/receipt/repository'
import { loadReceiptListOrigin, receiptFormPath, validateReceiptReturnTo } from '~/lib/receipt/return-context'
import { yuan } from '~/lib/util/money'
import ReceiptReferenceLink from '../../../../components/receipt/ReceiptReferenceLink.vue'
import ReceiptRowLink from './ReceiptRowLink.vue'

const route = useRoute()
const router = useRouter()
const repository = useNuxtApp().$repositories.receipts
const visibility = useDataVisibilityStore()
const page = shallowRef<ReceiptPage | null>(null)
const problem = shallowRef<ProblemDTO | null>(null)
const loading = shallowRef(true)
const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const contextId = `origin_${crypto.randomUUID().replaceAll('-', '')}`
const region = useTemplateRef<HTMLElement>('region')
let generation = 0
let active = true
let activated = false
const query = computed(() => ({ ...route.query, includeDemo: visibility.includeDemo }))
const rows = computed(() => page.value?.items.map(detail => ({ ...detail.record.draft, id: `${detail.record.dataOrigin}:${detail.record.id}`, dataOrigin: detail.record.dataOrigin, cumulativeReceipt: detail.amounts.cumulativeReceipt, detail })) ?? [])
const restored = computed(() => loadReceiptListOrigin(route.fullPath))
const sourceReturnTo = computed(() => validateReceiptReturnTo(route.query.returnTo, route.query.origin === 'demo' ? 'demo' : 'real'))
const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'no', title: '收款编号', minWidth: 175, fixed: 'left', slot: 'no' },
  { field: 'dataOrigin', title: '来源', width: 76, slot: 'origin' },
  { field: 'project', title: '项目', minWidth: 190, slot: 'project' },
  { field: 'category', title: '收款分类', width: 110, slot: 'unrecorded' },
  { field: 'customer', title: '付款方客户', minWidth: 170, slot: 'customer' },
  { field: 'contract', title: '施工合同', minWidth: 175, slot: 'contract' },
  { field: 'receiptDate', title: '收款日期', type: 'date' },
  { field: 'amount', title: '收款金额', type: 'money', width: 145, slot: 'amount' },
  { field: 'paymentMethod', title: '收款方式', width: 115 },
  { field: 'receiptType', title: '收款类型', width: 110, slot: 'unrecorded' },
  { field: 'cumulativeReceipt', title: '累计合同收款', type: 'money', width: 150, slot: 'cumulativeReceipt' },
  { field: 'status', title: '状态', width: 110, slot: 'status' },
]
function patchQuery(patch: Record<string, string | number | null>) {
  if (!active || route.path !== '/finance/receipt')
    return
  const next = { ...route.query }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '' || (key === 'page' && value === 1))
      delete next[key]
    else next[key] = String(value)
  }
  delete next.nav
  void router.replace({ path: '/finance/receipt', query: next, hash: '' })
}
function selectProject(value: string) {
  const divider = value.indexOf(':')
  patchQuery({ projectId: value ? value.slice(divider + 1) : null, ...(value ? { origin: value.slice(0, divider) } : {}), page: 1 })
}
const searchLater = useDebounceFn((value: string) => patchQuery({ search: value.trim(), page: 1 }), 250)
watch(search, (value) => {
  if (value !== (route.query.search ?? ''))
    void searchLater(value)
})
async function restorePosition() {
  if (!active || route.path !== '/finance/receipt')
    return
  await nextTick()
  const value = restored.value
  const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (value && workspace)
    workspace.scrollTop = value.scrollTop
  let id: string
  try {
    id = decodeURIComponent(route.hash.slice(1))
  }
  catch { return }
  const link = [...(region.value?.querySelectorAll<HTMLElement>('a[id]') ?? [])].find(item => item.id === id)
  link?.focus({ preventScroll: true })
}
async function load() {
  if (!active || route.path !== '/finance/receipt')
    return
  const current = ++generation
  const requestQuery = query.value
  loading.value = true
  page.value = null
  problem.value = null
  try {
    const result = await repository.list(requestQuery)
    if (current !== generation || !active)
      return
    page.value = result
    if (result.pagination.page !== result.pagination.requestedPage) {
      await patchQuery({ page: result.pagination.page === 1 ? null : result.pagination.page })
      return
    }
  }
  catch (cause) {
    if (current === generation)
      problem.value = receiptProblemFromUnknown(cause).problem
  }
  finally {
    if (current === generation)
      loading.value = false
  }
  if (current === generation && page.value)
    await restorePosition()
}
watch(query, () => {
  if (route.path === '/finance/receipt') {
    search.value = String(route.query.search ?? '')
    void load()
  }
}, {
  immediate: true,
})
onActivated(() => {
  active = true
  if (activated)
    void load()
  activated = true
})
onDeactivated(() => {
  active = false
  generation++
  page.value = null
})
onScopeDispose(() => {
  active = false
  generation++
})
</script>

<template>
  <div ref="region" class="min-w-0">
    <NuxtLink v-if="sourceReturnTo" :to="sourceReturnTo" class="mb-3 inline-flex items-center gap-1 text-12px text-brand">
      <span class="i-lucide-arrow-left" aria-hidden="true" />返回来源页面
    </NuxtLink>
    <ListShell continuous>
      <template #heading>
        <h2 class="m-0 text-15px font-800">
          收款登记
        </h2>
      </template>
      <template #toolbar>
        <input v-model="search" type="search" aria-label="查找收款" placeholder="收款编号 / 项目 / 客户" class="field-input h-8 w-full max-w-72 py-1 text-12px">
      </template>
      <template #actions>
        <KitButton :disabled="loading" @click="load">
          重新读取
        </KitButton><NuxtLink v-if="page?.capabilities.includes('receipt:write')" :to="receiptFormPath(null, route.fullPath)" class="btn-primary h-8 px-4 text-12px">
          新增收款
        </NuxtLink>
      </template>
      <template #filters>
        <div class="flex min-w-0 flex-wrap items-center gap-2" aria-label="收款筛选">
          <select class="field-input h-8 min-w-0 w-52 max-w-full py-1 text-12px" :value="route.query.projectId ? `${route.query.origin || 'real'}:${route.query.projectId}` : ''" aria-label="筛选项目" @change="selectProject(($event.target as HTMLSelectElement).value)">
            <option value="">
              全部项目
            </option><option v-for="project in page?.projectOptions ?? []" :key="`${project.dataOrigin}:${project.id}`" :value="`${project.dataOrigin}:${project.id}`">
              {{ project.name }}{{ project.dataOrigin === 'demo' ? '（演示）' : '' }}
            </option>
          </select>
          <SelectFilter :model-value="String(route.query.status || 'all')" aria-label="筛选状态" :options="[{ key: 'all', label: '全部状态' }, { key: 'draft', label: '草稿' }, { key: 'submitted', label: '已提交' }, { key: 'confirmed', label: '已确认' }, { key: 'void', label: '已作废' }]" @update:model-value="patchQuery({ status: $event === 'all' ? null : ($event ?? null), page: 1 })" />
          <SelectFilter v-if="visibility.includeDemo" :model-value="String(route.query.origin || 'all')" aria-label="筛选来源" :options="[{ key: 'all', label: '全部来源' }, { key: 'real', label: '正式' }, { key: 'demo', label: '演示' }]" @update:model-value="patchQuery({ origin: $event === 'all' ? null : ($event ?? null), projectId: null, page: 1 })" />
        </div>
      </template>
      <template #table>
        <StatePanel v-if="problem" :kind="['forbidden', 'unauthenticated'].includes(problem.code) ? 'forbidden' : 'error'" :title="problem.code === 'unauthenticated' ? '登录已失效' : '收款列表暂不可用'" :description="problem.message" action-label="重新读取" @action="load" /><KitTable v-else :columns="columns" :data="rows" :loading="loading" :page="page?.pagination" :page-size-options="[10, 20, 50, 100]" :restore-scroll-left="restored?.scrollLeft" :empty="{ title: '暂无符合条件的收款', description: '可以调整筛选条件，或新增收款登记。' }" @page-change="({ page: nextPage, pageSize }) => patchQuery({ page: nextPage, pageSize })" @view-restored="restorePosition">
          <template #no="{ row }">
            <ReceiptRowLink :detail="row.detail" :source="route.fullPath" :context-id="contextId" />
          </template>
          <template #origin="{ row }">
            <KitStatusTag :tone="row.dataOrigin === 'demo' ? 'warn' : 'brand'">
              {{ row.dataOrigin === 'demo' ? '演示' : '正式' }}
            </KitStatusTag>
          </template>
          <template #project="{ row }">
            <ReceiptReferenceLink :reference="row.detail.project" :origin="row.dataOrigin" />
          </template>
          <template #customer="{ row }">
            <ReceiptReferenceLink :reference="row.detail.customer" :origin="row.dataOrigin" />
          </template>
          <template #contract="{ row }">
            <ReceiptReferenceLink :reference="row.detail.contract" :origin="row.dataOrigin" />
          </template>
          <template #unrecorded>
            <span class="text-ink-faint">未记录</span>
          </template>
          <template #amount="{ row }">
            <span data-ui="receipt-list-amount">{{ yuan(row.amount) }}</span>
          </template>
          <template #cumulativeReceipt="{ row }">
            <span :title="row.detail.contractProblem?.message ?? ''">{{ yuan(row.cumulativeReceipt) }}</span>
          </template>
          <template #status="{ row }">
            <KitStatusTag :tone="financeStatusTone(row.status)">
              {{ financeStatusLabel(row.status) }}
            </KitStatusTag>
          </template>
        </KitTable>
      </template>
      <template #summary>
        <template v-if="page">
          <span>正式 {{ page.summary.origins.real.count }} 笔 · 有效收款 {{ yuan(page.summary.origins.real.effectiveAmount) }}</span><span v-if="visibility.includeDemo">演示 {{ page.summary.origins.demo.count }} 笔 · 有效收款 {{ yuan(page.summary.origins.demo.effectiveAmount) }}</span>
        </template><span v-else>当前汇总尚未读取</span>
      </template>
    </ListShell>
  </div>
</template>
