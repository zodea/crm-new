<script setup lang="ts">
import type { ProjectDetailTabKey } from '~/lib/project/subtables'
import { computed, onMounted, shallowRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  projectId: string
}>()

const detailStore = useProjectDetailStore()
const invoiceStore = useInvoiceStore()

const refreshing = shallowRef(true)
const loadError = shallowRef('')
const operation = computed(() => detailStore.operationSummaries[props.projectId] ?? null)
const invoice = computed(() => detailStore.invoiceSummaries[props.projectId] ?? null)
const hasSummary = computed(() => operation.value != null && invoice.value != null)
// 仅在 hasSummary 分支渲染；单独暴露非空计算值让模板类型检查保留这一不变量。
const resolvedOperation = computed(() => operation.value!)
const resolvedInvoice = computed(() => invoice.value!)

const taxBurdenRate = computed(() => !invoice.value || invoice.value.outputAmount === 0
  ? '—'
  : new Intl.NumberFormat('zh-CN', {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(invoice.value.taxBurdenRate))

const currentBalance = computed(() => operation.value
  ? operation.value.currentReceipt - operation.value.currentPayment
  : '—')
const metricStatus = computed(() =>
  loadError.value
    ? '刷新失败，展示上次结果'
    : refreshing.value
      ? '正在刷新'
      : '已加载',
)
const completeMetricMeta = computed(() => ({
  status: metricStatus.value,
  cutoff: '当前数据库快照',
  missingSources: '无已知缺口',
}))
const managementFeeMetricMeta = computed(() => ({
  status: '待接入',
  cutoff: '不适用',
  missingSources: '管理费配置',
}))
const balanceMetricMeta = computed(() => ({
  status: '部分可用',
  cutoff: '当前数据库快照',
  missingSources: '管理费配置',
}))

function projectTab(tab: ProjectDetailTabKey) {
  return {
    path: `/project/${props.projectId}`,
    query: { tab },
  }
}

async function refresh() {
  refreshing.value = true
  loadError.value = ''
  try {
    // 从源单页签返回项目详情时重新读取 SQLite，避免 Pinia 缓存保留修改/确认/软删前的快照。
    await Promise.all([
      detailStore.load(true),
      invoiceStore.load(),
    ])
  }
  catch (cause) {
    loadError.value = toErrorMessage(cause)
  }
  finally {
    refreshing.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <StatePanel
    v-if="!hasSummary && refreshing"
    kind="loading"
    title="正在汇总项目经营数据"
    compact
  />
  <StatePanel
    v-else-if="!hasSummary && loadError"
    kind="error"
    title="项目经营数据加载失败"
    :description="loadError"
    action-label="重新加载"
    compact
    @action="refresh"
  />
  <StatePanel
    v-else-if="!hasSummary"
    kind="empty"
    title="暂无可用的项目经营汇总"
    description="汇总源未返回当前项目记录，未知事实不会按 0 展示。"
    action-label="重新加载"
    compact
    @action="refresh"
  />

  <template v-else>
    <div
      class="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-11px text-ink-faint"
      aria-label="指标完整性"
    >
      <span>状态：{{ loadError ? '刷新失败，展示上次结果' : refreshing ? '正在刷新' : '已加载' }}</span>
      <span>各金额卡分别标注汇总截止与缺失来源</span>
      <button v-if="loadError" type="button" class="text-brand hover:underline" @click="refresh">
        重试
      </button>
    </div>

    <section class="mb-3" aria-label="项目经营数据">
      <SectionHeader>
        <span>项目经营数据</span>
        <template #extra>
          <span class="text-11px text-ink-faint">自动计算 · 来自下方子表聚合</span>
        </template>
      </SectionHeader>
      <MetricGrid :cols="4">
        <Metric v-bind="completeMetricMeta" label="主合同金额" :value="resolvedOperation.mainContractAmount" money formula="Σ 施工合同.含税合同金额" :to="projectTab('construction')" />
        <Metric v-bind="completeMetricMeta" label="增补合同额" :value="resolvedOperation.supplementAmount" money formula="Σ 补充协议.金额" :to="projectTab('construction')" />
        <Metric v-bind="completeMetricMeta" label="变洽签审定额" :value="resolvedOperation.ownerChangeAmount" money formula="Σ 甲方变洽签.含税审定金额" :to="projectTab('construction')" />
        <Metric v-bind="completeMetricMeta" label="变更后合同额" :value="resolvedOperation.changedContractAmount" money formula="主合同 + 增补 + 变洽签" :to="projectTab('construction')" />
        <Metric v-bind="completeMetricMeta" label="项目收款" :value="resolvedOperation.projectReceipt" money tone="ok" formula="Σ 收款登记.收款金额" :to="projectTab('fund')" />
        <Metric v-bind="completeMetricMeta" label="确认支付" :value="resolvedOperation.paymentAmount" money tone="danger" formula="Σ 已确认支付记录.支付金额" :to="projectTab('payment')" />
        <Metric v-bind="managementFeeMetricMeta" label="管理费" value="—" formula="管理费来源尚未接入；未知值不以 0 代替" />
        <Metric v-bind="balanceMetricMeta" label="已知资金余额" :value="resolvedOperation.availableBalance" money big tone="brand" formula="项目收款 + 往来收款 − 确认支付 − 往来付款（不含尚未接入的管理费）" />
      </MetricGrid>
    </section>

    <section class="mb-3" aria-label="往来款">
      <SectionHeader>
        <span>往来款</span>
        <template #extra>
          <span class="text-11px text-ink-faint">正式往来收付事实</span>
        </template>
      </SectionHeader>
      <MetricGrid :cols="3">
        <Metric v-bind="completeMetricMeta" label="往来收款" :value="resolvedOperation.currentReceipt" money tone="ok" formula="Σ 正式往来收款.收款金额" :to="projectTab('current')" />
        <Metric v-bind="completeMetricMeta" label="往来付款" :value="resolvedOperation.currentPayment" money tone="danger" formula="Σ 正式往来付款.付款金额" :to="projectTab('current')" />
        <Metric v-bind="completeMetricMeta" label="往来净额" :value="currentBalance" money tone="brand" formula="往来收款 − 往来付款" :to="projectTab('current')" />
      </MetricGrid>
    </section>

    <section class="mb-3" aria-label="票据信息">
      <SectionHeader>
        <span>票据信息</span>
        <template #extra>
          <span class="chip-brand">{{ resolvedInvoice.archivedCount }} 张归档票</span>
        </template>
      </SectionHeader>
      <MetricGrid :cols="6">
        <Metric v-bind="completeMetricMeta" label="销项票额" :value="resolvedInvoice.outputAmount" money formula="Σ 开票申请.开票金额" :to="projectTab('tax')" />
        <Metric v-bind="completeMetricMeta" label="销项税额" :value="resolvedInvoice.outputTax" money formula="Σ 开票申请.税额" :to="projectTab('tax')" />
        <Metric
          v-bind="completeMetricMeta"
          label="进项票额"
          :value="resolvedInvoice.inputAmount"
          money
          formula="Σ 本项目已归档发票.金额"
          :to="{ path: '/finance/ledger', query: { project: projectId } }"
        />
        <Metric v-bind="completeMetricMeta" label="进项税额" :value="resolvedInvoice.inputTax" money formula="Σ 本项目已归档发票.税额" :to="{ path: '/finance/ledger', query: { project: projectId } }" />
        <Metric v-bind="completeMetricMeta" label="增值税" :value="resolvedInvoice.vat" money formula="销项税额 − 进项税额" :to="projectTab('tax')" />
        <Metric v-bind="completeMetricMeta" label="税负率" :value="taxBurdenRate" formula="销项票额为 0 时不可计算；否则为增值税 ÷ 销项票额" />
      </MetricGrid>
    </section>
  </template>
</template>
