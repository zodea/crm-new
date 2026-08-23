<script setup lang="ts">
import type { CustomerRelationTab } from './CustomerDetailRelations.vue'
import type { DataOriginDTO } from '~/types/read-model'
import { computed, nextTick, onActivated, shallowRef, watch } from 'vue'
import { loadCustomerReturnOrigin, resolveCustomerReturnContext } from '~/lib/customer/return-context'
import { yuan } from '~/lib/util/money'
import { useCustomerReadStore } from '~/stores/customer-read'

const props = defineProps<{
  customerId: string
  origin: DataOriginDTO
  includeDemo: boolean
  returnTo?: string
  returnContext?: string
}>()
const route = useRoute()
const router = useRouter()
const store = useCustomerReadStore()
const relationTabs = new Set<CustomerRelationTab>(['projects', 'contracts', 'receipts'])
const activeTab = shallowRef<CustomerRelationTab>(validTab(route.query.tab))

const detail = computed(() => {
  const state = store.detailState
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
})
const customer = computed(() => detail.value?.customer ?? null)
const backTo = computed(() => resolveCustomerReturnContext({
  returnTo: props.returnTo,
  contextId: props.returnContext,
  now: Date.now(),
  load: loadCustomerReturnOrigin,
}).to)
const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
  const kind = store.detailState.kind
  if (detail.value)
    return 'ready'
  if (kind === 'ready' || kind === 'partial' || kind === 'empty')
    return 'ready'
  if (kind === 'idle' || kind === 'loading')
    return 'loading'
  if (kind === 'forbidden')
    return 'forbidden'
  if (kind === 'not-found')
    return 'not-found'
  return 'error'
})
const problem = computed(() => 'problem' in store.detailState ? store.detailState.problem : null)
const canEdit = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('customer:write'))
const editTo = computed(() => {
  const query = new URLSearchParams({ origin: 'real' })
  if (props.returnTo && props.returnContext) {
    query.set('returnTo', props.returnTo)
    query.set('returnContext', props.returnContext)
  }
  return `/base/customer/form/${encodeURIComponent(props.customerId)}?${query.toString()}`
})
const tabs = computed(() => [
  { key: 'projects', label: '名下项目', count: detail.value?.projects.length ?? 0 },
  { key: 'contracts', label: '施工合同', count: detail.value?.contracts.length ?? 0 },
  { key: 'receipts', label: '收款明细', count: detail.value?.receipts.length ?? 0 },
])

useTabTitle(() => customer.value?.name)

function validTab(value: unknown): CustomerRelationTab {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && relationTabs.has(candidate as CustomerRelationTab)
    ? candidate as CustomerRelationTab
    : 'projects'
}

function selectTab(value: string | undefined) {
  const next = validTab(value)
  activeTab.value = next
  const query = { ...route.query }
  if (next === 'projects')
    delete query.tab
  else
    query.tab = next
  void router.replace({ query })
}

async function load() {
  await store.loadDetail({ id: props.customerId, origin: props.origin, includeDemo: props.includeDemo })
  if (store.detailState.kind === 'ready') {
    await nextTick()
    document.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
  }
}

watch(() => [props.customerId, props.origin, props.includeDemo], () => void load(), { immediate: true })
watch(() => route.query.tab, value => activeTab.value = validTab(value))
onActivated(() => void load())
</script>

<template>
  <EntityDetailShell
    :title="customer?.name ?? '客户详情'"
    :subtitle="customer ? [customer.taxNo, customer.aliases.join('、')].filter(Boolean).join(' · ') : ''"
    :back-to="backTo"
    back-label="返回客户列表"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '客户不存在或已删除' : shellState === 'forbidden' ? '无权查看该客户' : shellState === 'loading' ? '正在加载客户详情' : '客户详情加载失败'"
    :state-description="problem?.message ?? ''"
    :state-action-label="problem?.retryable ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div v-if="customer" class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand">
        {{ customer.name.slice(0, 1) }}
      </div>
    </template>
    <template #status>
      <span v-if="customer" :class="customer.status === 'active' ? 'chip chip-ok' : 'chip chip-warn'">
        {{ customer.status === 'active' ? '有效' : customer.status === 'draft' ? '草稿' : customer.status || '未登记' }}
      </span>
      <span v-if="detail" class="chip">{{ detail.dataOrigin === 'demo' ? '测试数据' : '正式数据' }}</span>
    </template>
    <template #actions>
      <NuxtLink v-if="canEdit" :to="editTo" class="btn-primary" aria-label="编辑客户">
        <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑
      </NuxtLink>
      <span v-else-if="detail?.dataOrigin === 'demo'" class="text-11px text-ink-faint">测试客户只读</span>
    </template>
    <template #summary>
      <MetricGrid v-if="detail" :cols="5" data-testid="customer-summary">
        <Metric label="名下项目" :value="`${detail.summary.projectCount} 个`" />
        <Metric label="施工合同" :value="`${detail.summary.contractCount} 份`" />
        <Metric label="有效合同额" :value="yuan(detail.summary.effectiveContractAmount)" />
        <Metric label="有效收款" :value="yuan(detail.summary.effectiveReceiptAmount)" />
        <Metric label="待收差额" :value="yuan(detail.summary.outstandingAmount)" />
      </MetricGrid>
    </template>
    <div v-if="customer && detail" class="flex min-w-0 flex-col gap-4">
      <StatePanel
        v-if="store.detailState.kind === 'error'"
        kind="error"
        title="刷新客户详情失败"
        :description="store.detailState.problem.message"
        :action-label="store.detailState.problem.retryable ? '重新加载' : ''"
        compact
        @action="load"
      />
      <CustomerDetailOverview :customer="customer" />
      <section class="panel min-w-0 overflow-hidden" aria-labelledby="customer-relations-heading">
        <div class="flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <h3 id="customer-relations-heading" class="m-0 mr-auto text-14px font-800 text-ink">
            业务关系
          </h3>
          <nav class="min-w-0 max-w-full overflow-x-auto" aria-label="客户业务关系">
            <SegTab :model-value="activeTab" :tabs="tabs" @update:model-value="selectTab" />
          </nav>
        </div>
        <div class="min-w-0 p-3">
          <CustomerDetailRelations
            :tab="activeTab"
            :projects="detail.projects"
            :contracts="detail.contracts"
            :receipts="detail.receipts"
            :return-to="returnTo"
            :return-context="returnContext"
          />
        </div>
      </section>
    </div>
  </EntityDetailShell>
</template>
