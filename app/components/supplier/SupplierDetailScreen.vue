<script setup lang="ts">
import type { SupplierFactTab } from './SupplierFactTable.vue'
import type { DataOriginDTO, MetricDTO } from '~/types/read-model'
import { computed, nextTick, onActivated, shallowRef, watch } from 'vue'
import { validateMaterialContractDetailJourneyReturnTo } from '~/lib/material-contract/return-context'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
import { validateProjectSupplierIdentityReturnTo } from '~/lib/project-supplier/return-context'
import {
  createSupplierDetailJourneyReturnOrigin,
  loadSupplierDetailJourneyReturnOrigin,
  newSupplierDetailJourneyReturnContextId,
  resolveSupplierDetailJourneyReturnOrigin,
  saveSupplierDetailJourneyReturnOrigin,
  validateSupplierDetailReturnTo,
  validateSupplierReturnTo,
} from '~/lib/supplier/return-context'
import { yuan } from '~/lib/util/money'
import { useSupplierReadStore } from '~/stores/supplier-read'

const props = defineProps<{
  supplierId: string
  origin: DataOriginDTO
  includeDemo: boolean
  returnTo?: string
  returnContext?: string
}>()
const route = useRoute()
const router = useRouter()
const store = useSupplierReadStore()
const factTabs = new Set<SupplierFactTab>(['projects', 'contracts', 'settlements', 'invoices', 'payments'])
const activeTab = shallowRef<SupplierFactTab>(validTab(route.query.tab))
const subcontractChangeContextId = shallowRef(newSupplierDetailJourneyReturnContextId())
const subcontractChangeAnchorId = 'supplier-subcontract-change-link'

const detail = computed(() => {
  const state = store.detailState
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
})
const supplier = computed(() => detail.value?.supplier ?? null)
const materialContractReturnTo = computed(() => validateMaterialContractDetailJourneyReturnTo(props.returnTo, props.origin))
const subcontractChangeReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(props.returnTo, props.origin, 'sub_change'))
const projectSupplierReturnTo = computed(() => validateProjectSupplierIdentityReturnTo(props.returnTo, {
  entity: 'supplier',
  id: props.supplierId,
  origin: props.origin,
}))
const backTo = computed(() => validateSupplierReturnTo(props.returnTo)
  ?? materialContractReturnTo.value
  ?? subcontractChangeReturnTo.value
  ?? projectSupplierReturnTo.value
  ?? '/base/supplier')
const backLabel = computed(() => materialContractReturnTo.value
  ? '返回材料采购合同'
  : subcontractChangeReturnTo.value
    ? '返回分包变洽签'
    : projectSupplierReturnTo.value
      ? '返回项目分供方工作台'
      : '返回分供方列表')
const problem = computed(() => 'problem' in store.detailState ? store.detailState.problem : null)
const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
  if (detail.value)
    return 'ready'
  if (store.detailState.kind === 'idle' || store.detailState.kind === 'loading')
    return 'loading'
  if (store.detailState.kind === 'forbidden')
    return 'forbidden'
  if (store.detailState.kind === 'not-found')
    return 'not-found'
  return 'error'
})
const canEdit = computed(() => detail.value?.dataOrigin === 'real' && detail.value.capabilities.includes('supplier:write'))
const canReadSubcontractChanges = computed(() => detail.value?.dataOrigin === 'real'
  && detail.value.capabilities.includes('subcontract-document:read'))
const editTo = computed(() => {
  const query = new URLSearchParams({ origin: 'real' })
  const returnTo = validateSupplierReturnTo(props.returnTo)
  if (returnTo)
    query.set('returnTo', returnTo)
  return `/base/supplier/form/${encodeURIComponent(props.supplierId)}?${query.toString()}`
})
const credentialTo = computed(() => {
  const query = new URLSearchParams({ origin: props.origin })
  const returnTo = validateSupplierReturnTo(props.returnTo)
  if (returnTo)
    query.set('returnTo', returnTo)
  return `/base/supplier/credential/${encodeURIComponent(props.supplierId)}?${query.toString()}`
})
const subcontractChangesReturnTo = computed(() => {
  const supplierQuery = new URLSearchParams({ origin: props.origin })
  const supplierListReturnTo = validateSupplierReturnTo(props.returnTo)
  if (supplierListReturnTo)
    supplierQuery.set('returnTo', supplierListReturnTo)
  supplierQuery.set('subChangeJourney', subcontractChangeContextId.value)
  return validateSupplierDetailReturnTo(
    `/base/supplier/${encodeURIComponent(props.supplierId)}?${supplierQuery.toString()}#${subcontractChangeAnchorId}`,
    props.origin,
    props.supplierId,
  )
})
const subcontractChangesTo = computed(() => {
  const query = new URLSearchParams({
    supplier: props.supplierId,
    origin: props.origin,
  })
  if (subcontractChangesReturnTo.value)
    query.set('returnTo', subcontractChangesReturnTo.value)
  return `/subcontract/change?${query.toString()}`
})
const tabs = computed(() => [
  { key: 'projects', label: '合作项目', count: detail.value?.projects.length ?? 0 },
  { key: 'contracts', label: '合同事实', count: detail.value?.contracts.length ?? 0 },
  { key: 'settlements', label: '结算事实', count: detail.value?.settlements.length ?? 0 },
  { key: 'invoices', label: '收票事实', count: detail.value?.invoices.length ?? 0 },
  { key: 'payments', label: '付款事实', count: detail.value?.payments.length ?? 0 },
])
const summaryRows = computed(() => detail.value
  ? [
      { label: '合作项目', value: `${detail.value.summary.projectCount} 个`, tab: 'projects' as const, metric: null },
      { label: '累计合同金额', value: yuan(detail.value.summary.contractAmount.value), tab: 'contracts' as const, metric: detail.value.summary.contractAmount },
      { label: '累计结算金额', value: yuan(detail.value.summary.settlementAmount.value), tab: 'settlements' as const, metric: detail.value.summary.settlementAmount },
      { label: '累计收票金额', value: yuan(detail.value.summary.invoiceAmount.value), tab: 'invoices' as const, metric: detail.value.summary.invoiceAmount },
      { label: '累计付款金额', value: yuan(detail.value.summary.paymentAmount.value), tab: 'payments' as const, metric: detail.value.summary.paymentAmount },
      { label: '应付金额', value: yuan(detail.value.summary.payableAmount.value), tab: null, metric: detail.value.summary.payableAmount },
    ]
  : [])

useTabTitle(() => supplier.value?.name)

function validTab(value: unknown): SupplierFactTab {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && factTabs.has(candidate as SupplierFactTab) ? candidate as SupplierFactTab : 'projects'
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

function summaryClickable(row: { tab: SupplierFactTab | null, metric: MetricDTO | null }) {
  return Boolean(row.tab && (row.metric === null || row.metric.drilldown))
}

function workspaceScrollTop(): number {
  return document.querySelector<HTMLElement>('[data-shell-workspace]')?.scrollTop
    ?? document.scrollingElement?.scrollTop
    ?? window.scrollY
}

function captureSubcontractChangeOrigin() {
  if (!subcontractChangesReturnTo.value)
    return
  try {
    saveSupplierDetailJourneyReturnOrigin(createSupplierDetailJourneyReturnOrigin({
      contextId: subcontractChangeContextId.value,
      returnTo: subcontractChangesReturnTo.value,
      anchorId: subcontractChangeAnchorId,
      scrollTop: workspaceScrollTop(),
      now: Date.now(),
    }))
  }
  catch {
    // 浏览器存储不可用时仍允许导航，返回时按受限锚点降级。
  }
}

async function restoreSubcontractChangeOrigin(): Promise<boolean> {
  const returnTo = validateSupplierDetailReturnTo(route.fullPath, props.origin, props.supplierId)
  if (!returnTo)
    return false
  const url = new URL(returnTo, 'https://ruihang.invalid')
  const anchorId = decodeURIComponent(url.hash.slice(1))
  if (anchorId !== subcontractChangeAnchorId)
    return false
  await nextTick()
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  const target = document.getElementById(anchorId)
  if (!target)
    return false
  const origin = resolveSupplierDetailJourneyReturnOrigin({
    returnTo,
    contextId: url.searchParams.get('subChangeJourney'),
    now: Date.now(),
    load: id => loadSupplierDetailJourneyReturnOrigin(id),
  })
  const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
  if (origin && workspace)
    workspace.scrollTop = origin.scrollTop
  else
    target.scrollIntoView?.({ block: 'center' })
  target.focus({ preventScroll: true })
  if (origin && workspace) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    workspace.scrollTop = origin.scrollTop
  }
  return true
}

async function load() {
  await store.loadDetail({ id: props.supplierId, origin: props.origin, includeDemo: props.includeDemo })
  if (store.detailState.kind === 'ready') {
    const restored = await restoreSubcontractChangeOrigin()
    if (!restored) {
      await nextTick()
      document.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
    }
  }
}

watch(() => [props.supplierId, props.origin, props.includeDemo], () => void load(), { immediate: true })
watch(() => route.query.tab, value => activeTab.value = validTab(value))
onActivated(() => void load())
</script>

<template>
  <EntityDetailShell
    :title="supplier?.name ?? '分供方详情'"
    :subtitle="supplier ? [supplier.supplierCategory, supplier.taxNo, supplier.contact].filter(Boolean).join(' · ') : ''"
    :back-to="backTo"
    :back-label="backLabel"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '分供方不存在或已删除' : shellState === 'forbidden' ? '无权查看该分供方' : shellState === 'loading' ? '正在加载分供方详情' : '分供方详情加载失败'"
    :state-description="problem?.message ?? ''"
    :state-action-label="problem?.retryable ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div v-if="supplier" class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand">
        {{ supplier.name.slice(0, 1) }}
      </div>
    </template>
    <template #status>
      <span v-if="supplier" :class="supplier.credentialStatus === 'complete' ? 'chip chip-ok' : 'chip chip-warn'">{{ supplier.credentialStatus === 'complete' ? '资料完整' : '资料待完善' }}</span>
      <span v-if="detail" class="chip">{{ detail.dataOrigin === 'demo' ? '测试数据' : '正式数据' }}</span>
    </template>
    <template #actions>
      <NuxtLink
        v-if="canReadSubcontractChanges"
        :id="subcontractChangeAnchorId"
        :to="subcontractChangesTo"
        class="btn-secondary"
        aria-label="查看分包变洽签"
        @click="captureSubcontractChangeOrigin"
      >
        <span class="i-lucide-file-search mr-1" aria-hidden="true" />分包变洽签
      </NuxtLink>
      <NuxtLink :to="credentialTo" class="btn-secondary" aria-label="证照附件" data-ui="supplier-credential-link">
        <span class="i-lucide-folder-lock mr-1" aria-hidden="true" />证照附件
      </NuxtLink>
      <NuxtLink v-if="canEdit" :to="editTo" class="btn-primary" aria-label="编辑分供方">
        <span class="i-lucide-square-pen mr-1" aria-hidden="true" />编辑
      </NuxtLink>
      <span v-else-if="detail?.dataOrigin === 'demo'" class="text-11px text-ink-faint">测试分供方只读</span>
    </template>
    <template #summary>
      <MetricGrid v-if="detail" :cols="6" data-testid="supplier-summary">
        <template v-for="row in summaryRows" :key="row.label">
          <button v-if="summaryClickable(row)" type="button" class="min-w-0 border-0 bg-transparent p-0 text-left hover:bg-surface-2 focus-visible:outline-brand" :aria-label="`查看${row.label}明细`" @click="selectTab(row.tab ?? undefined)">
            <Metric :label="row.label" :value="row.value" tone="brand" />
          </button>
          <div v-else class="min-w-0">
            <Metric :label="row.label" :value="row.value" />
          </div>
        </template>
      </MetricGrid>
    </template>
    <div v-if="supplier && detail" class="flex min-w-0 flex-col gap-4">
      <StatePanel v-if="store.detailState.kind === 'error'" kind="error" title="刷新分供方详情失败" :description="store.detailState.problem.message" :action-label="store.detailState.problem.retryable ? '重新加载' : ''" compact @action="load" />
      <SupplierDetailOverview :supplier="supplier" />
      <section class="panel min-w-0 overflow-hidden" aria-labelledby="supplier-facts-heading">
        <div class="flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <h3 id="supplier-facts-heading" class="m-0 mr-auto text-14px font-800 text-ink">
            真实业务事实
          </h3>
          <nav class="min-w-0 max-w-full overflow-x-auto" aria-label="分供方业务事实">
            <SegTab :model-value="activeTab" :tabs="tabs" @update:model-value="selectTab" />
          </nav>
        </div>
        <div class="min-w-0 p-3">
          <SupplierFactTable :tab="activeTab" :projects="detail.projects" :contracts="detail.contracts" :settlements="detail.settlements" :invoices="detail.invoices" :payments="detail.payments" />
        </div>
      </section>
    </div>
  </EntityDetailShell>
</template>
