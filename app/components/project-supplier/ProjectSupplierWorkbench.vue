<script setup lang="ts">
import type { ProjectSupplierWorkbenchReadDTO } from '~/lib/project-supplier/repository'
import type { ProjectSupplierWorkbenchTab } from '~/lib/project-supplier/workbench'
import { computed, shallowRef, watch } from 'vue'
import { projectSupplierWorkbenchTab } from '~/lib/project-supplier/workbench'
import { yuan } from '~/lib/util/money'
import { isDataOriginDTO } from '~/types/read-model'

const props = defineProps<{ projectId: string, supplierId: string }>()
const route = useRoute()
const router = useRouter()
const readStore = useProjectSupplierReadStore()
const visibility = useDataVisibilityStore()
const activeTab = shallowRef<ProjectSupplierWorkbenchTab>('overview')
const origin = computed(() => isDataOriginDTO(route.query.origin) ? route.query.origin : 'real')
const data = computed<ProjectSupplierWorkbenchReadDTO | null>(() => {
  const state = readStore.state
  if (state.kind === 'ready' || state.kind === 'empty' || state.kind === 'partial')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
})
const refreshing = computed(() => readStore.state.kind === 'loading')
const fileContext = computed(() => {
  const current = data.value
  if (!current || refreshing.value || current.project.id !== props.projectId || current.supplier.id !== props.supplierId
    || current.dataOrigin !== origin.value || (current.dataOrigin === 'demo' && !visibility.includeDemo)
    || !current.capabilities.includes('project-supplier:read')) {
    return null
  }
  return { projectId: props.projectId, supplierId: props.supplierId, relationId: current.relation.id, origin: current.dataOrigin, includeDemo: visibility.includeDemo }
})
const returnTo = computed(() => `/project/${encodeURIComponent(props.projectId)}/supplier/${encodeURIComponent(props.supplierId)}${origin.value === 'demo' ? '?origin=demo&' : '?'}tab=${activeTab.value}`)

useTabTitle(() => data.value?.supplier.label)

const tabs = computed(() => [
  { key: 'overview' as const, label: '合作概览', count: null },
  { key: 'contract' as const, label: '合同', count: data.value?.counts.contracts ?? 0 },
  { key: 'claim' as const, label: '请款', count: data.value?.counts.claims ?? 0 },
  { key: 'ticket' as const, label: '收票', count: data.value?.counts.invoices ?? 0 },
  { key: 'payment' as const, label: '付款', count: data.value?.counts.payments ?? 0 },
  { key: 'settlement' as const, label: '结算', count: data.value?.counts.settlements ?? 0 },
])
const date = (value: string | null) => value || '—'
const contractRows = computed(() => (data.value?.contracts ?? []).map(row => ({ id: row.contract.id, navigation: row.navigation, cells: [
  { text: row.contract.no || '—', tone: 'muted' as const },
  { text: row.contract.label },
  { text: row.kind },
  { text: yuan(row.amount), tone: 'money' as const },
  { text: yuan(row.effectiveAmount), tone: 'money' as const },
  { text: date(row.signDate), tone: 'muted' as const },
  { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
  { text: row.status, tone: 'status' as const },
] })))
const claimRows = computed(() => (data.value?.claims ?? []).map(row => ({ id: row.application.id, navigation: row.navigation, cells: [
  { text: row.application.no || '—', tone: 'muted' as const },
  { text: row.application.label },
  { text: yuan(row.applyAmount), tone: 'money' as const },
  { text: yuan(row.approvedAmount), tone: 'money' as const },
  { text: date(row.applyDate), tone: 'muted' as const },
  { text: row.invoiceState },
  { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
  { text: row.status, tone: 'status' as const },
] })))
const invoiceRows = computed(() => (data.value?.invoices ?? []).map(row => ({ id: row.invoice.id, navigation: row.navigation, cells: [
  { text: row.invoice.no || '—', tone: 'muted' as const },
  { text: date(row.invoiceDate), tone: 'muted' as const },
  { text: row.invoiceType },
  { text: yuan(row.totalAmount), tone: 'money' as const },
  { text: yuan(row.taxAmount), tone: 'money' as const },
  { text: row.fileName, tone: 'muted' as const },
  { text: row.accountStatus, tone: 'status' as const },
] })))
const paymentRows = computed(() => (data.value?.payments ?? []).map(row => ({ id: row.payment.id, navigation: row.navigation, cells: [
  { text: row.payment.no || '—', tone: 'muted' as const },
  { text: date(row.paymentDate), tone: 'muted' as const },
  { text: yuan(row.allocatedAmount), tone: 'money' as const },
  { text: row.paymentMethod },
  { text: row.voucherNo || '—', tone: 'muted' as const },
  { text: row.applicationNos.join('、'), tone: 'muted' as const },
  { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
  { text: row.confirmationStatus, tone: 'status' as const },
] })))
const settlementRows = computed(() => (data.value?.settlements ?? []).map(row => ({ id: row.settlement.id, navigation: row.navigation, cells: [
  { text: row.settlement.no || '—', tone: 'muted' as const },
  { text: row.settlement.label },
  { text: row.settlementType },
  { text: yuan(row.totalAmount), tone: 'money' as const },
  { text: date(row.settlementDate), tone: 'muted' as const },
  { text: `${row.attachmentCount} 份`, tone: 'muted' as const },
  { text: row.status, tone: 'status' as const },
] })))

async function load() {
  if (!visibility.initialized)
    await visibility.initialize()
  await readStore.load({ projectId: props.projectId, supplierId: props.supplierId, origin: origin.value, includeDemo: visibility.includeDemo })
}
async function selectTab(tab: ProjectSupplierWorkbenchTab) {
  activeTab.value = tab
  await router.replace({ query: { ...(origin.value === 'demo' ? { origin: 'demo' } : {}), tab } })
}
watch(() => [props.projectId, props.supplierId, origin.value, route.query.tab, visibility.includeDemo] as const, async () => {
  const requested = projectSupplierWorkbenchTab(route.query.tab) ?? 'overview'
  activeTab.value = requested
  if (route.query.tab !== requested || Object.keys(route.query).some(key => !['origin', 'tab'].includes(key))) {
    await router.replace({ query: { ...(origin.value === 'demo' ? { origin: 'demo' } : {}), tab: requested } })
    return
  }
  await load()
}, { immediate: true })
</script>

<template>
  <main class="mx-auto min-w-0 max-w-[96rem] space-y-3 px-3 py-3 sm:px-4" data-testid="project-supplier-workbench">
    <StatePanel v-if="!data && (readStore.state.kind === 'idle' || readStore.state.kind === 'loading')" kind="loading" title="正在加载项目分供方事实" />
    <StatePanel v-else-if="!data && readStore.state.kind === 'forbidden'" kind="forbidden" title="无权查看项目分供方事实" :description="readStore.state.problem.message" />
    <StatePanel v-else-if="!data && readStore.state.kind === 'mismatch'" kind="error" title="项目与分供方关系不匹配" :description="readStore.state.problem.message" />
    <StatePanel v-else-if="!data && readStore.state.kind === 'not-found'" kind="empty" title="未找到项目或分供方" :description="readStore.state.problem.message" />
    <StatePanel v-else-if="!data && readStore.state.kind === 'error'" kind="error" title="工作台加载失败" :description="readStore.state.problem.message" :action-label="readStore.state.problem.retryable ? '重新加载' : ''" @action="load" />
    <template v-else-if="data">
      <ProjectSupplierWorkbenchHeader :data="data" :refreshing="refreshing" @refresh="load" />
      <StatePanel v-if="readStore.state.kind === 'error'" kind="error" title="刷新失败，当前展示上次成功数据" :description="readStore.state.problem.message" :action-label="readStore.state.problem.retryable ? '重试' : ''" compact @action="load" />
      <nav class="panel min-w-0 overflow-x-auto" aria-label="项目分供方事实分类">
        <div class="flex min-w-max border-b border-line" role="tablist">
          <button v-for="tab in tabs" :key="tab.key" type="button" role="tab" :aria-selected="activeTab === tab.key" class="border-b-2 px-4 py-3 text-12px font-700" :class="activeTab === tab.key ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'" @click="selectTab(tab.key)">
            {{ tab.label }}<span v-if="tab.count !== null" class="ml-1 text-10px text-ink-faint">{{ tab.count }}</span>
          </button>
        </div>
      </nav>
      <ProjectSupplierOverview v-if="activeTab === 'overview'" :data="data" :return-to="returnTo" />
      <section v-else class="panel min-w-0 overflow-hidden" :aria-label="`${tabs.find(tab => tab.key === activeTab)?.label}事实`">
        <ProjectSupplierFactTable v-if="activeTab === 'contract'" :columns="['合同编号', '合同名称', '类型', '合同额', '变更后合同额', '签订日期', '附件', '状态']" :rows="contractRows" empty="暂无合同事实" :return-to="returnTo" />
        <ProjectSupplierFactTable v-else-if="activeTab === 'claim'" :columns="['请款编号', '请款名称', '申请金额', '审批金额', '申请日期', '发票状态', '附件', '状态']" :rows="claimRows" empty="暂无请款事实" :return-to="returnTo" />
        <ProjectSupplierFactTable v-else-if="activeTab === 'ticket'" :columns="['发票号码', '开票日期', '类型', '含税金额', '税额', '文件', '入账状态']" :rows="invoiceRows" empty="暂无收票事实" :return-to="returnTo" />
        <ProjectSupplierFactTable v-else-if="activeTab === 'payment'" :columns="['支付编号', '支付日期', '本关系分摊金额', '方式', '凭证号', '请款单', '附件', '确认状态']" :rows="paymentRows" empty="暂无付款事实" :return-to="returnTo" />
        <ProjectSupplierFactTable v-else :columns="['结算编号', '结算名称', '类型', '结算金额', '结算日期', '附件', '状态']" :rows="settlementRows" empty="暂无结算事实" :return-to="returnTo" />
      </section>
      <ProjectSupplierFileAccess :files="data.files" :return-to="returnTo" :context="fileContext" />
      <p class="m-0 text-right text-10px text-ink-faint">
        数据时间 {{ data.asOf.replace('T', ' ').replace('Z', '') }} · {{ data.sourceVersion || '中央版本未标注' }}
      </p>
    </template>
  </main>
</template>
