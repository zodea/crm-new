<script setup lang="ts">
import type { SubcontractContractDetailReadDTO } from '~/lib/subcontract-contract/repository'
import type { DataOriginDTO, NavigationIntentDTO, ReadState } from '~/types/read-model'
import { computed, onActivated, watch } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { validateOwnerDocumentDetailReturnTo } from '~/lib/owner-document/return-context'
import { validateSubcontractContractReturnTo } from '~/lib/subcontract-contract/return-context'
import { yuan } from '~/lib/util/money'
import { useDataVisibilityStore } from '~/stores/data-visibility'
import { useSubcontractContractReadStore } from '~/stores/subcontract-contract-read'

const props = defineProps<{ contractId: string, origin: DataOriginDTO }>()
const route = useRoute()
const router = useRouter()
const store = useSubcontractContractReadStore()
const visibilityStore = useDataVisibilityStore()
const state = computed(() => store.detailState as ReadState<SubcontractContractDetailReadDTO>)
const detail = computed(() => {
  const current = state.value
  if (current.kind === 'ready')
    return current.data
  if ((current.kind === 'loading' || current.kind === 'error') && current.previous)
    return current.previous
  return null
})
const tabs = [
  { key: 'info', label: '详细资料' },
  { key: 'changes', label: '分包变洽签' },
  { key: 'invoices', label: '收票登记' },
  { key: 'payments', label: '付款' },
  { key: 'settlements', label: '结算' },
  { key: 'penalties', label: '项目罚扣' },
  { key: 'material-uses', label: '材料领用' },
]
const tabKeys = new Set(tabs.map(tab => tab.key))
const activeTab = computed({
  get: () => typeof route.query.tab === 'string' && tabKeys.has(route.query.tab) ? route.query.tab : 'info',
  set: value => void router.replace({ query: { ...route.query, tab: value === 'info' ? undefined : value, focus: undefined } }),
})
const focusId = computed(() => route.query.tab === 'changes'
  && typeof route.query.focus === 'string'
  ? route.query.focus
  : null)
const ownerDocumentReturnTo = computed(() => validateOwnerDocumentDetailReturnTo(route.query.returnTo, props.origin, 'sub_change'))
const returnTo = computed(() => ownerDocumentReturnTo.value
  ?? validateSubcontractContractReturnTo(route.query.returnTo, props.origin)
  ?? '/contract/subcontract')
const backLabel = computed(() => ownerDocumentReturnTo.value ? '返回来源详情' : '返回分包合同列表')
const canEdit = computed(() => detail.value?.dataOrigin === 'real' && detail.value.capabilities.includes('subcontract-contract:write'))
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
const stateTitle = computed(() => state.value.kind === 'mismatch' ? '合同来源或类别不匹配' : shellState.value === 'loading' ? '正在读取分包合同' : shellState.value === 'forbidden' ? '无权查看该分包合同' : shellState.value === 'not-found' ? '未找到分包合同' : '分包合同读取失败')
const metrics = computed(() => {
  const amounts = detail.value?.contract.amounts
  if (!amounts)
    return []
  const rows: Array<[string, string]> = [
    ['合同金额', amounts.contract],
    ['变更后金额', amounts.changed],
    ['累计结算', amounts.settled],
    ['累计收票', amounts.invoiced],
    ['累计付款', amounts.paid],
    ['按结算应付', amounts.bySettlementPayable],
    ['按收票应付', amounts.byInvoicePayable],
    ['完工审定', amounts.completionSettlement],
  ]
  return rows.map(([label, value]) => ({ label, value: yuan(Number(value)) }))
})

function target(intent: NavigationIntentDTO): string | null {
  const result = resolveNavigationTarget(intent)
  return result.state === 'resolved' ? result.to : null
}

function load() {
  return store.loadDetail({ id: props.contractId, origin: props.origin, includeDemo: props.origin === 'demo' && visibilityStore.includeDemo, focusId: focusId.value })
}

function edit() {
  void navigateTo({ path: `/contract/subcontract/form/${encodeURIComponent(props.contractId)}`, query: { origin: 'real', contractKind: 'subcontract', returnTo: route.fullPath } })
}

watch(() => [props.contractId, props.origin, focusId.value], () => void load(), { immediate: true })
onActivated(() => void load())
useTabTitle(() => detail.value?.contract.name ?? '分包合同详情')
</script>

<template>
  <div class="subcontract-contract-detail min-w-0" data-testid="subcontract-contract-detail">
    <EntityDetailShell :title="detail?.contract.name ?? '分包合同详情'" :subtitle="detail?.contract.no || '编号未填写'" :back-to="returnTo" :back-label="backLabel" :state="shellState" :state-title="stateTitle" :state-description="problem?.message ?? ''" :state-action-label="problem?.retryable ? '重新加载' : ''" @state-action="load">
      <template #status>
        <template v-if="detail">
          <span class="chip" :class="detail.dataOrigin === 'demo' ? 'chip-warn' : 'chip-brand'">{{ detail.dataOrigin === 'demo' ? '演示只读' : '正式数据' }}</span><span class="chip bg-surface-3 text-ink-soft">{{ detail.contract.subKind }}</span><span class="chip bg-surface-3 text-ink-soft">{{ detail.contract.status }}</span>
        </template>
      </template>
      <template #actions>
        <button v-if="canEdit" type="button" class="btn-secondary" data-testid="subcontract-contract-edit" @click="edit">
          编辑合同
        </button>
      </template>
      <template #summary>
        <MetricGrid v-if="detail" :cols="8">
          <Metric v-for="metric in metrics" :key="metric.label" :label="metric.label" :value="metric.value" />
        </MetricGrid>
      </template>
      <div v-if="detail" class="space-y-3">
        <StatePanel v-if="state.kind === 'error'" kind="error" title="刷新分包合同失败" :description="`${state.problem.message}；当前保留上一次成功读取的详情。`" compact />
        <div class="panel min-w-0 overflow-hidden px-3">
          <SegTab v-model="activeTab" :tabs="tabs" />
        </div>
        <section v-if="activeTab === 'info'" class="panel p-4">
          <SectionHeader title="详细资料" subtitle="分包合同头、稳定关系与独立状态事实" />
          <div class="mt-3 grid gap-x-7 [grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr))]">
            <div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">所属项目</span><NuxtLink v-if="target(detail.projectNavigation)" :to="target(detail.projectNavigation)!" class="min-w-0 [overflow-wrap:anywhere] text-brand hover:underline">
                {{ detail.contract.project.state === 'resolved' ? detail.contract.project.label : '不可用' }}
              </NuxtLink><strong v-else class="min-w-0 [overflow-wrap:anywhere]">不可用</strong>
            </div>
            <div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">乙方分供方</span><NuxtLink v-if="target(detail.supplierNavigation)" :to="target(detail.supplierNavigation)!" class="min-w-0 [overflow-wrap:anywhere] text-brand hover:underline">
                {{ detail.contract.supplier.state === 'resolved' ? detail.contract.supplier.label : '不可用' }}
              </NuxtLink><strong v-else class="min-w-0 [overflow-wrap:anywhere]">不可用</strong>
            </div>
            <div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">签约日期</span><strong class="min-w-0 [overflow-wrap:anywhere]">{{ detail.contract.signDate || '未记录' }}</strong>
            </div><div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">发票类型</span><strong class="min-w-0 [overflow-wrap:anywhere]">{{ detail.contract.invoiceType || '未记录' }}</strong>
            </div>
            <div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">结算状态</span><strong class="min-w-0 [overflow-wrap:anywhere]" data-testid="subcontract-settlement-status">{{ detail.contract.settlementStatus || '未记录' }}</strong>
            </div><div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">结清状态</span><strong class="min-w-0 [overflow-wrap:anywhere]" data-testid="subcontract-clearance-status">{{ detail.contract.clearanceStatus || '未记录' }}</strong>
            </div>
            <div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">履约联系人</span><strong class="min-w-0 [overflow-wrap:anywhere]">{{ detail.contract.contactName || '未记录' }}</strong>
            </div><div class="flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">联系电话</span><strong class="min-w-0 [overflow-wrap:anywhere]">{{ detail.contract.contactPhone || '未记录' }}</strong>
            </div>
            <div class="col-span-full flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">合同内容</span><strong class="min-w-0 [overflow-wrap:anywhere]">{{ detail.contract.content || '未记录' }}</strong>
            </div><div class="col-span-full flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">主要条款</span><strong class="min-w-0 [overflow-wrap:anywhere]">{{ detail.contract.mainTerms || '未记录' }}</strong>
            </div><div class="col-span-full flex min-w-0 gap-3 border-b border-dashed border-line py-2.5 text-13px">
              <span class="w-28 flex-none text-ink-soft">付款条款</span><strong class="min-w-0 [overflow-wrap:anywhere]">{{ detail.contract.paymentTerms || '未记录' }}</strong>
            </div>
          </div>
          <SectionHeader class="mt-5" title="合同文件" /><ul v-if="detail.sections.files.length" class="mt-2 divide-y divide-line rounded border border-line">
            <li v-for="file in detail.sections.files" :key="file.id" class="flex flex-wrap justify-between gap-2 p-3 text-12px">
              <span>{{ file.fileName }}</span><span class="text-ink-soft">{{ file.category }} · {{ file.fileSize }} B</span>
            </li>
          </ul><StatePanel v-else class="mt-2" kind="empty" title="暂无合同文件" description="中央详情尚未关联合同文件。" compact />
        </section>
        <section v-else-if="activeTab === 'changes'" class="space-y-3">
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="补充合同" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.supplements" empty-label="暂无补充合同" :focus-id="focusId" :return-to="returnTo" />
          </div><div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="分包变洽签" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.changes" empty-label="暂无分包变洽签" :focus-id="focusId" :return-to="route.fullPath" />
          </div>
        </section>
        <section v-else-if="activeTab === 'invoices'" class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader title="收票登记" subtitle="只统计已归档发票事实" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.invoices" empty-label="暂无收票登记" />
        </section>
        <section v-else-if="activeTab === 'payments'" class="space-y-3">
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="付款申请" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.payments.applications" empty-label="暂无付款申请" />
          </div><div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="付款登记" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.payments.records" empty-label="暂无已确认付款登记" />
          </div>
        </section>
        <section v-else-if="activeTab === 'settlements'" class="space-y-3">
          <div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="进度结算" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.settlements.progress" empty-label="暂无进度结算" />
          </div><div class="panel min-w-0 overflow-hidden p-4">
            <SectionHeader title="完工结算" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.settlements.completion" empty-label="暂无完工结算" />
          </div>
        </section>
        <section v-else-if="activeTab === 'penalties'" class="panel min-w-0 overflow-hidden p-4">
          <SectionHeader title="项目罚扣" /><SubcontractContractFactTable class="mt-3" :rows="detail.sections.penalties" empty-label="暂无项目罚扣" />
        </section>
        <section v-else class="space-y-3" data-testid="subcontract-material-uses">
          <StatePanel kind="empty" title="暂无可归属的材料使用记录" description="现有库房与历史材料使用数据均缺少合同或分供方稳定外键，因此不做名称推断。" />
        </section>
      </div>
    </EntityDetailShell>
  </div>
</template>
