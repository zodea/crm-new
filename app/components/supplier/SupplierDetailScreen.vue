<script setup lang="ts">
import type { SupplierFactTab } from './SupplierFactTable.vue'
import type { DataOriginDTO, MetricDTO } from '~/types/read-model'
import { computed, nextTick, onActivated, shallowRef, useTemplateRef, watch } from 'vue'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { validateAuxiliaryDetailReturnTo } from '~/lib/auxiliary-contract/navigation'
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
import { CREDENTIAL_STATUS_LABEL, CREDENTIAL_STATUS_TONE } from '~/lib/supplier/status'
import { formatShanghaiDateTime } from '~/lib/util/datetime'
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
const supplierNavigation = useTemplateRef<HTMLElement>('supplierNavigation')
const store = useSupplierReadStore()
type SupplierDetailTab = 'overview' | SupplierFactTab
const factTabs = new Set<SupplierDetailTab>(['overview', 'projects', 'contracts', 'settlements', 'invoices', 'payments'])
const activeTab = shallowRef<SupplierDetailTab>(validTab(route.query.tab))
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
const credentialLabel = computed(() => {
  const status = supplier.value?.credentialStatus
  return status ? CREDENTIAL_STATUS_LABEL[status] ?? '未知状态' : '未记录'
})
const credentialTone = computed(() => CREDENTIAL_STATUS_TONE[supplier.value?.credentialStatus ?? ''] ?? 'neutral')
const materialContractReturnTo = computed(() => validateMaterialContractDetailJourneyReturnTo(props.returnTo, props.origin))
const subcontractChangeReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(props.returnTo, props.origin, 'sub_change'))
const subcontractSettlementReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(props.returnTo, props.origin, 'sub_settlement'))
const projectSupplierReturnTo = computed(() => validateProjectSupplierIdentityReturnTo(props.returnTo, {
  entity: 'supplier',
  id: props.supplierId,
  origin: props.origin,
}))
const projectPenaltyReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(props.returnTo, props.origin, 'project_penalty'))
const auxiliaryReturnTo = computed(() => validateAuxiliaryDetailReturnTo(props.returnTo, props.origin))
const backTo = computed(() => validateSupplierReturnTo(props.returnTo)
  ?? materialContractReturnTo.value
  ?? subcontractChangeReturnTo.value
  ?? subcontractSettlementReturnTo.value
  ?? projectPenaltyReturnTo.value
  ?? projectSupplierReturnTo.value
  ?? auxiliaryReturnTo.value
  ?? '/base/supplier')
const backLabel = computed(() => auxiliaryReturnTo.value
  ? '返回其他支出合同'
  : projectPenaltyReturnTo.value
    ? '返回项目罚扣'
    : materialContractReturnTo.value
      ? '返回材料采购合同'
      : subcontractSettlementReturnTo.value
        ? '返回分包结算'
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
  { key: 'overview', label: '详细资料' },
  { key: 'projects', label: '合作项目', count: unavailable('projects') ? undefined : detail.value?.projects.length ?? 0 },
  { key: 'contracts', label: '支出合同', count: unavailable('contracts') ? undefined : detail.value?.contracts.length ?? 0 },
  { key: 'settlements', label: '支出结算', count: unavailable('settlements') ? undefined : detail.value?.settlements.length ?? 0 },
  { key: 'invoices', label: '收票登记', count: unavailable('invoices') ? undefined : detail.value?.invoices.length ?? 0 },
  { key: 'payments', label: '付款管理', count: unavailable('payments') ? undefined : detail.value?.payments.length ?? 0 },
])
function unavailable(tab: SupplierDetailTab) {
  return tab !== 'overview' && detail.value?.unavailableSources?.includes(tab) === true
}
const overviewMetadata = computed(() => supplier.value
  ? [
      { label: '分供方类别', value: supplier.value.supplierCategory },
      { label: '评价等级', value: supplier.value.rating },
      { label: '主要联系人', value: supplier.value.contact },
      { label: '联系电话', value: supplier.value.contactPhone },
      { label: '详细地址', value: supplier.value.address },
    ]
  : [])
const recordFields = computed(() => supplier.value
  ? [
      { label: '唯一识别码', value: supplier.value.uniqueCode },
      { label: '经营类型', value: supplier.value.businessType },
      { label: '资料状态', value: credentialLabel.value },
      { label: '更新时间', value: formatShanghaiDateTime(supplier.value.updatedAt) },
    ]
  : [])
const summaryRows = computed(() => detail.value
  ? [
      { label: '合作项目', value: detail.value.summary.projectCount === null ? '—' : `${detail.value.summary.projectCount} 个`, tab: 'projects' as const, metric: null },
      { label: '累计合同金额', value: yuan(detail.value.summary.contractAmount.value), tab: 'contracts' as const, metric: detail.value.summary.contractAmount },
      { label: '累计结算金额', value: yuan(detail.value.summary.settlementAmount.value), tab: 'settlements' as const, metric: detail.value.summary.settlementAmount },
      { label: '累计收票金额', value: yuan(detail.value.summary.invoiceAmount.value), tab: 'invoices' as const, metric: detail.value.summary.invoiceAmount },
      { label: '累计付款金额', value: yuan(detail.value.summary.paymentAmount.value), tab: 'payments' as const, metric: detail.value.summary.paymentAmount },
      { label: '应付金额', value: yuan(detail.value.summary.payableAmount.value), tab: null, metric: detail.value.summary.payableAmount },
    ]
  : [])

useTabTitle(() => supplier.value?.name)

function validTab(value: unknown): SupplierDetailTab {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && factTabs.has(candidate as SupplierDetailTab) ? candidate as SupplierDetailTab : 'overview'
}

function selectTab(value: string | undefined) {
  const next = validTab(value)
  activeTab.value = next
  const query = { ...route.query }
  if (next === 'overview')
    delete query.tab
  else
    query.tab = next
  void router.replace({ query })
}

function summaryClickable(row: { tab: SupplierFactTab | null, metric: MetricDTO | null }) {
  return Boolean(row.tab && !unavailable(row.tab) && (row.metric === null || row.metric.drilldown))
}

async function selectSummaryTab(tab: SupplierFactTab | null) {
  if (!tab)
    return
  selectTab(tab)
  await nextTick()
  supplierNavigation.value?.scrollIntoView?.({ block: 'start', inline: 'nearest' })
  supplierNavigation.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true })
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
    if (!restored && route.hash !== '#auxiliary-contract-journey') {
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
    compact
    :title="supplier?.name ?? '分供方详情'"
    :back-to="backTo"
    :back-label="backLabel"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '分供方不存在或已删除' : shellState === 'forbidden' ? '无权查看该分供方' : shellState === 'loading' ? '正在加载分供方详情' : '分供方详情加载失败'"
    :state-description="problem?.message ?? ''"
    :state-action-label="problem?.retryable ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div v-if="supplier" class="grid h-8 w-8 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px text-brand">
        <span class="i-lucide-building-2" />
      </div>
    </template>
    <template #status>
      <KitStatusTag v-if="supplier" :tone="credentialTone">
        {{ credentialLabel }}
      </KitStatusTag>
      <KitStatusTag v-if="detail?.dataOrigin === 'demo'" tone="neutral">
        测试数据
      </KitStatusTag>
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
      <dl class="supplier-metadata">
        <div v-for="item in overviewMetadata" :key="item.label" class="min-w-0">
          <dt class="m-0 mb-1 text-12px text-ink-soft">
            {{ item.label }}
          </dt>
          <dd class="m-0 whitespace-pre-wrap break-words text-14px leading-5 text-ink">
            {{ item.value || '—' }}
          </dd>
        </div>
      </dl>
    </template>
    <template #navigation>
      <nav ref="supplierNavigation" aria-label="分供方业务事实">
        <SegTab :model-value="activeTab" :tabs="tabs" @update:model-value="selectTab" />
      </nav>
    </template>
    <div v-if="supplier && detail" class="grid min-w-0 gap-2">
      <StatePanel v-if="store.detailState.kind === 'error'" kind="error" title="刷新分供方详情失败" :description="store.detailState.problem.message" :action-label="store.detailState.problem.retryable ? '重新加载' : ''" compact @action="load" />
      <SupplierDetailOverview v-if="activeTab === 'overview'" :supplier="supplier" />
      <section v-else class="min-w-0 bg-panel p-3" :aria-label="tabs.find(tab => tab.key === activeTab)?.label">
        <StatePanel v-if="unavailable(activeTab)" kind="empty" title="此项业务事实尚未接入" description="当前无法核对数量与金额，不能按零或没有记录理解。分供方主档及证照资料仍可查看。" compact />
        <SupplierFactTable v-else :tab="activeTab" :projects="detail.projects" :contracts="detail.contracts" :settlements="detail.settlements" :invoices="detail.invoices" :payments="detail.payments" />
      </section>
    </div>
    <template v-if="supplier && detail" #aside>
      <div class="grid min-w-0 gap-2">
        <section class="min-w-0 bg-panel" aria-labelledby="supplier-cooperation-heading">
          <h3 id="supplier-cooperation-heading" class="m-0 border-b border-line px-4 py-3 text-14px font-700 text-ink">
            往期合作情况
          </h3>
          <dl class="m-0 grid min-w-0 gap-4 p-4" data-testid="supplier-summary">
            <div v-for="row in summaryRows" :key="row.label" class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <dt class="text-12px text-ink-soft">
                {{ row.label }}
              </dt>
              <dd class="m-0 min-w-0">
                <button v-if="summaryClickable(row)" type="button" class="border-0 bg-transparent p-0 text-left text-14px font-600 tabular-nums text-brand hover:underline focus-visible:outline-brand" :aria-label="`查看${row.label}明细`" @click="selectSummaryTab(row.tab)">
                  {{ row.value }}
                </button>
                <span v-else class="text-14px font-600 tabular-nums text-ink">{{ row.value }}</span>
              </dd>
            </div>
          </dl>
        </section>
        <ReadOnlySection title="档案信息" :fields="recordFields" />
        <AuxiliaryContractJourney v-if="detail.dataOrigin === 'real' && !unavailable('contracts')" :supplier-id="supplierId" />
      </div>
    </template>
  </EntityDetailShell>
</template>

<style scoped>
.supplier-metadata {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  gap: 16px 24px;
  margin: 0;
}
</style>
