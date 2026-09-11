<script setup lang="ts">
import type { ConstructionContractDetailFocusDTO, ConstructionContractDetailReadDTO } from '~/lib/construction-contract/repository'
import type { DataOriginDTO, NavigationIntentDTO, ReadState } from '~/types/read-model'
import { useTimeoutFn } from '@vueuse/core'
import { useReceiptSourceReturn } from '~/composables/useReceiptSourceReturn'
import { validateConstructionContractReturnTo } from '~/lib/construction-contract/return-context'
import { resolveCustomerRelationReturnOrigin } from '~/lib/customer/return-context'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
import { loadReceiptSourceOrigin } from '~/lib/receipt/return-context'
import { yuan } from '~/lib/util/money'
import { useConstructionContractReadStore } from '~/stores/construction-contract-read'
import { useDataVisibilityStore } from '~/stores/data-visibility'

const props = defineProps<{ contractId: string, origin: DataOriginDTO }>()
const route = useRoute()
const restoreReceiptSource = useReceiptSourceReturn()
const receiptReturnOrigin = computed(() => loadReceiptSourceOrigin(route.fullPath))
const router = useRouter()
const store = useConstructionContractReadStore()
const visibilityStore = useDataVisibilityStore()
const state = computed(() => store.detailState as ReadState<ConstructionContractDetailReadDTO>)
const detail = computed(() => {
  const current = state.value
  if (current.kind === 'ready')
    return current.data
  if ((current.kind === 'loading' || current.kind === 'error') && current.previous)
    return current.previous
  return null
})
const loading = computed(() => state.value.kind === 'loading')
const tabs = computed(() => [
  { key: 'info', label: '详细资料' },
  { key: 'supplements', label: `补充合同 ${detail.value?.sections.supplements.length ?? 0}` },
  { key: 'changes', label: `甲方变洽签 ${detail.value?.sections.changes.length ?? 0}` },
  { key: 'settlements', label: '验收结算' },
  { key: 'invoices', label: '票税管理' },
  { key: 'receipts', label: `收款登记 ${detail.value?.sections.receipts.length ?? 0}` },
  { key: 'acceptance', label: '竣工验收及保修' },
])
const tabKeys = new Set(tabs.value.map(tab => tab.key))
const activeTab = computed({
  get: () => typeof route.query.tab === 'string' && tabKeys.has(route.query.tab) ? route.query.tab : 'info',
  set: value => void router.replace({
    query: {
      ...route.query,
      tab: value === 'info' ? undefined : value,
      focus: undefined,
      focusView: undefined,
    },
    hash: '',
  }),
})
const focusId = computed(() => ['supplements', 'changes', 'settlements', 'acceptance'].includes(String(route.query.tab ?? ''))
  && typeof route.query.focus === 'string'
  ? route.query.focus
  : null)
const focusScope = computed(() => {
  if (focusId.value === null)
    return null
  const scopes = {
    supplements: 'supplement',
    changes: 'change',
    settlements: 'settlement',
    acceptance: 'acceptance',
  } as const
  return scopes[route.query.tab as keyof typeof scopes] ?? null
})
const focusView = computed(() => route.query.focusView === 'acceptance' || route.query.focusView === 'warranty'
  ? route.query.focusView
  : null)
const focus = computed<ConstructionContractDetailFocusDTO | null>(() => {
  if (!focusId.value)
    return null
  if (focusScope.value === 'acceptance')
    return { id: focusId.value, scope: 'acceptance', view: focusView.value }
  return { id: focusId.value, scope: focusScope.value }
})
const ownerDocumentReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(route.query.returnTo, props.origin))
const returnCheckTime = shallowRef(Date.now())
const customerReturnOrigin = computed(() => resolveCustomerRelationReturnOrigin(route.query.returnTo, {
  targetEntity: 'contract',
  targetId: props.contractId,
  origin: props.origin,
}, Math.max(returnCheckTime.value, Date.now())))
const { start: startReturnExpiry, stop: stopReturnExpiry } = useTimeoutFn(
  () => returnCheckTime.value = Date.now(),
  () => Math.max(0, (customerReturnOrigin.value?.expiresAt ?? 0) - Date.now() + 1),
  { immediate: false },
)
watch(customerReturnOrigin, origin => origin ? startReturnExpiry() : stopReturnExpiry(), { immediate: true })
const customerReturnTo = computed(() => customerReturnOrigin.value?.returnTo ?? null)
const returnTo = computed(() => customerReturnTo.value ?? ownerDocumentReturnTo.value
  ?? validateConstructionContractReturnTo(route.query.returnTo, props.origin)
  ?? '/contract/construction')
const backLabel = computed(() => customerReturnTo.value ? '返回客户详情' : ownerDocumentReturnTo.value ? '返回来源详情' : '返回施工合同列表')
const canEdit = computed(() => detail.value?.dataOrigin === 'real' && detail.value.capabilities.includes('construction-contract:write'))
const boqTo = computed(() => {
  const current = detail.value
  if (!current || current.dataOrigin !== 'real' || current.contract.project.state !== 'resolved')
    return null
  return target({
    kind: 'entity-subview',
    subject: { state: 'resolved', entity: 'contract', id: current.contract.id, label: current.contract.name, no: current.contract.no || null },
    variant: 'boq',
    view: null,
    filters: { dataOrigin: 'real', contractKind: '施工', projectId: current.contract.project.id },
  })
})
const shellState = computed<'ready' | 'loading' | 'error' | 'forbidden' | 'not-found'>(() => {
  if (detail.value)
    return 'ready'
  if (state.value.kind === 'idle' || state.value.kind === 'loading')
    return 'loading'
  if (state.value.kind === 'forbidden')
    return 'forbidden'
  if (state.value.kind === 'not-found')
    return 'not-found'
  return 'error'
})
const problem = computed(() => 'problem' in state.value ? state.value.problem : null)
const stateTitle = computed(() => state.value.kind === 'mismatch'
  ? '合同来源或类别不匹配'
  : shellState.value === 'loading' ? '正在读取施工合同' : shellState.value === 'forbidden' ? '无权查看该施工合同' : shellState.value === 'not-found' ? '未找到施工合同' : '施工合同读取失败')

function target(intent: NavigationIntentDTO): string | null {
  const result = resolveNavigationTarget(intent)
  return result.state === 'resolved' ? result.to : null
}

const metrics = computed(() => {
  const amounts = detail.value?.contract.amounts
  if (!amounts)
    return []
  const rows: Array<[string, string | null]> = [
    ['合同金额', amounts.contract],
    ['变更后金额', amounts.changed],
    ['累计结算', amounts.settled],
    ['累计开票', amounts.invoiced],
    ['累计收款', amounts.received],
    ['按结算应收', amounts.bySettlementReceivable],
  ]
  return rows.map(([label, value]) => ({ label, value: yuan(value) }))
})

async function load() {
  await store.loadDetail({
    id: props.contractId,
    origin: props.origin,
    includeDemo: props.origin === 'demo' && visibilityStore.includeDemo,
    focus: focus.value,
  })
  if (store.detailState.kind === 'ready')
    await restoreReceiptSource(route.fullPath)
}

function edit() {
  void navigateTo({
    path: `/contract/construction/form/${encodeURIComponent(props.contractId)}`,
    query: { origin: 'real', contractKind: 'construction', returnTo: route.fullPath },
  })
}

watch(() => [props.contractId, props.origin, focus.value], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.contract.name ?? '施工合同详情')
</script>

<template>
  <div class="construction-contract-detail min-w-0" data-testid="construction-contract-detail">
    <EntityDetailShell
      :title="detail?.contract.name ?? '施工合同详情'"
      :subtitle="detail?.contract.no || '编号未填写'"
      :back-to="returnTo"
      :back-label="backLabel"
      :state="shellState"
      :state-title="stateTitle"
      :state-description="problem?.message ?? ''"
      :state-action-label="problem?.retryable ? '重新加载' : ''"
      @state-action="load"
    >
      <template #status>
        <template v-if="detail">
          <span class="chip" :class="detail.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">{{ detail.dataOrigin === 'demo' ? '演示只读' : '正式数据' }}</span>
          <span class="chip bg-surface-3 text-ink-soft">{{ detail.contract.status }}</span>
        </template>
      </template>
      <template #actions>
        <button v-if="canEdit" type="button" class="btn-secondary" data-testid="construction-contract-edit" @click="edit">
          编辑合同
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="6">
          <Metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value" />
        </MetricGrid>
      </template>

      <div v-if="detail" class="space-y-3">
        <StatePanel v-if="state.kind === 'error'" kind="error" title="刷新施工合同失败" :description="`${state.problem.message}；当前保留上一次成功读取的详情。`" :action-label="state.problem.retryable ? '重新加载' : ''" compact @action="load" />
        <StatePanel v-if="loading" kind="loading" title="正在刷新施工合同" description="当前保留上一次成功读取的详情。" compact />
        <div class="panel min-w-0 overflow-hidden px-3">
          <SegTab v-model="activeTab" :tabs="tabs" />
        </div>

        <section v-if="activeTab === 'info'" class="panel p-4">
          <SectionHeader title="详细资料" />
          <div class="construction-contract-grid mt-3">
            <div class="detail-row">
              <span>所属项目</span><NuxtLink v-if="target(detail.projectNavigation)" :to="target(detail.projectNavigation)!" class="text-brand hover:underline">
                {{ detail.contract.project.state === 'resolved' ? detail.contract.project.label : '不可用' }}
              </NuxtLink><strong v-else>不可用</strong>
            </div>
            <div class="detail-row">
              <span>甲方客户</span><NuxtLink v-if="target(detail.customerNavigation)" :to="target(detail.customerNavigation)!" class="text-brand hover:underline">
                {{ detail.contract.customer.state === 'resolved' ? detail.contract.customer.label : '不可用' }}
              </NuxtLink><strong v-else>不可用</strong>
            </div>
            <div class="detail-row">
              <span>签约日期</span><strong>{{ detail.contract.signDate || '未记录' }}</strong>
            </div>
            <div class="detail-row">
              <span>实际竣工日期</span><strong data-testid="construction-actual-completion">{{ detail.contract.actualCompletionDate || '未记录' }}</strong>
            </div>
            <div class="detail-row">
              <span>发票类型</span><strong>{{ detail.contract.invoiceType || '未记录' }}</strong>
            </div>
            <div class="detail-row">
              <span>履约联系人</span><strong>{{ detail.contract.contactName || '未记录' }}</strong>
            </div>
            <div class="detail-row">
              <span>联系电话</span><strong>{{ detail.contract.contactPhone || '未记录' }}</strong>
            </div>
            <div class="detail-row full">
              <span>合同内容</span><strong>{{ detail.contract.content || '未记录' }}</strong>
            </div>
            <div class="detail-row full">
              <span>主要条款</span><strong>{{ detail.contract.mainTerms || '未记录' }}</strong>
            </div>
            <div class="detail-row full">
              <span>付款条款</span><strong>{{ detail.contract.paymentTerms || '未记录' }}</strong>
            </div>
          </div>
          <div class="mt-4 rounded border border-line bg-surface-2 p-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong class="text-13px">工程量清单（BOQ）</strong>
              </div>
              <NuxtLink v-if="boqTo" :to="boqTo" class="btn-secondary" data-testid="construction-contract-boq">
                查看 BOQ
              </NuxtLink>
              <span v-else class="chip bg-surface-3 text-ink-soft">暂不可用</span>
            </div>
          </div>
          <SectionHeader class="mt-5" title="合同文件" />
          <ul v-if="detail.sections.files.length" class="mt-2 divide-y divide-line rounded border border-line">
            <li v-for="file in detail.sections.files" :key="file.id" class="flex flex-wrap items-center justify-between gap-2 p-3 text-12px">
              <span>{{ file.fileName }}</span><span class="text-ink-soft">{{ file.category }} · {{ file.fileSize }} B</span>
            </li>
          </ul><StatePanel v-else class="mt-2" kind="empty" title="暂无合同文件" compact />
        </section>

        <section v-else-if="activeTab === 'supplements'" class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader title="补充合同" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.supplements" empty-label="暂无补充合同" :focus-id="focusId" :return-to="returnTo" />
        </section>
        <section v-else-if="activeTab === 'changes'" class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader title="甲方变洽签" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.changes" empty-label="暂无甲方变洽签" :focus-id="focusId" :return-to="route.fullPath" />
        </section>
        <section v-else-if="activeTab === 'settlements'" class="space-y-3">
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="月度报量" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.settlements.monthlyStatements" empty-label="暂无月度报量" :focus-id="focusId" :return-to="route.fullPath" />
          </div>
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="最终结算" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.settlements.finalSettlements" empty-label="暂无最终结算" :focus-id="focusId" :return-to="route.fullPath" />
          </div>
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="甲方罚扣" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.settlements.penalties" empty-label="暂无甲方罚扣" :focus-id="focusId" :return-to="route.fullPath" />
          </div>
        </section>
        <section v-else-if="activeTab === 'invoices'" class="space-y-3">
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="开票申请" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.invoices.applications" empty-label="暂无开票申请" />
          </div>
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="销项开票登记" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.invoices.registrations" empty-label="暂无销项开票登记" />
          </div>
        </section>
        <section v-else-if="activeTab === 'receipts'" class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader title="收款登记" />
          <StatePanel v-if="detail.receiptsProblem" class="mt-3" :kind="detail.receiptsProblem.code === 'forbidden' ? 'forbidden' : 'error'" title="收款金额暂不可用" :description="detail.receiptsProblem.message" :action-label="detail.receiptsProblem.retryable ? '重新读取收款' : ''" compact @action="load" />
          <ConstructionContractFactTable v-else class="mt-3" :rows="detail.sections.receipts" empty-label="暂无收款登记" :return-to="route.fullPath" :restore-scroll-left="receiptReturnOrigin?.scrollLeft" @view-restored="restoreReceiptSource(route.fullPath)" />
        </section>
        <section v-else class="space-y-3">
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="竣工验收" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.acceptance.acceptances" empty-label="暂无竣工验收记录" :focus-id="focusView === null || focusView === 'acceptance' ? focusId : null" :return-to="route.fullPath" anchor-scope="acceptance" return-focus-view="acceptance" />
          </div>
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="保修到期" /><ConstructionContractFactTable class="mt-3" :rows="detail.sections.acceptance.warranties" empty-label="暂无保修到期记录" :focus-id="focusView === 'warranty' ? focusId : null" :return-to="route.fullPath" anchor-scope="warranty" return-focus-view="warranty" />
          </div>
        </section>
      </div>
    </EntityDetailShell>
  </div>
</template>

<style scoped>
.construction-contract-detail { container-type: inline-size; }
.construction-contract-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 0 28px; }
.detail-row { display: flex; min-width: 0; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.detail-row > span { width: 112px; flex: none; color: var(--ink-soft); }
.detail-row > strong { min-width: 0; overflow-wrap: anywhere; }
.detail-row.full { grid-column: 1 / -1; }
</style>
