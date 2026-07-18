<script setup lang="ts">
const props = defineProps<{
  projectId: string
}>()

const detailStore = useProjectDetailStore()
const invoiceStore = useInvoiceStore()

const operation = computed(() => detailStore.operationSummaries[props.projectId] ?? {
  mainContractAmount: 0,
  supplementAmount: 0,
  ownerChangeAmount: 0,
  changedContractAmount: 0,
  projectReceipt: 0,
  paymentAmount: 0,
  currentReceipt: 0,
  currentPayment: 0,
  managementFee: 0,
  availableBalance: 0,
})
const invoice = computed(() => detailStore.invoiceSummaries[props.projectId] ?? {
  outputAmount: 0,
  outputTax: 0,
  inputAmount: 0,
  inputTax: 0,
  vat: 0,
  taxBurdenRate: 0,
  archivedCount: 0,
})

const taxBurdenRate = computed(() => new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(invoice.value.taxBurdenRate))

onMounted(() => Promise.all([
  detailStore.load(),
  invoiceStore.load(),
]))
</script>

<template>
  <section class="mb-4" aria-labelledby="project-operation-title">
    <SectionHeader>
      <span id="project-operation-title">项目经营数据</span>
      <template #extra>
        <span class="text-11px text-ink-faint">自动计算 · 来自下方子表聚合</span>
      </template>
    </SectionHeader>
    <MetricGrid :cols="5">
      <Metric label="主合同金额" :value="operation.mainContractAmount" money formula="Σ 施工合同.含税合同金额" />
      <Metric label="增补合同额" :value="operation.supplementAmount" money formula="Σ 补充协议.金额" />
      <Metric label="变洽签审定额" :value="operation.ownerChangeAmount" money formula="Σ 甲方变洽签.含税审定金额" />
      <Metric label="变更后合同额" :value="operation.changedContractAmount" money formula="主合同 + 增补 + 变洽签" />
      <Metric label="项目收款" :value="operation.projectReceipt" money tone="ok" formula="Σ 收款登记.收款金额" />
      <Metric label="付款金额" :value="operation.paymentAmount" money tone="danger" formula="Σ 付款申请.实际支付金额" />
      <Metric label="往来收款" :value="operation.currentReceipt" money tone="ok" formula="Σ 往来收款.收款金额" />
      <Metric label="往来付款" :value="operation.currentPayment" money tone="danger" formula="Σ 往来付款.金额" />
      <Metric label="管理费 · seed" :value="operation.managementFee" money formula="管理费配置表未建，当前显示 seed 静态值" />
      <Metric label="项目可用资金余额" :value="operation.availableBalance" money big tone="brand" formula="项目收款 + 往来收款 − 付款金额 − 往来付款 − 管理费" />
    </MetricGrid>
  </section>

  <section class="mb-4" aria-labelledby="project-invoice-title">
    <SectionHeader>
      <span id="project-invoice-title">票据信息</span>
      <template #extra>
        <span class="chip-brand">{{ invoice.archivedCount }} 张归档票</span>
      </template>
    </SectionHeader>
    <MetricGrid :cols="6">
      <Metric label="销项票额" :value="invoice.outputAmount" money formula="Σ 开票申请.开票金额" />
      <Metric label="销项税额" :value="invoice.outputTax" money formula="Σ 开票申请.税额" />
      <Metric
        label="进项票额"
        :value="invoice.inputAmount"
        money
        formula="Σ 本项目已归档发票.金额"
        :to="{ path: '/finance/ledger', query: { project: projectId } }"
      />
      <Metric label="进项税额" :value="invoice.inputTax" money formula="Σ 本项目已归档发票.税额" />
      <Metric label="增值税" :value="invoice.vat" money formula="销项税额 − 进项税额" />
      <Metric label="税负率" :value="taxBurdenRate" formula="增值税 ÷ 销项票额" />
    </MetricGrid>
  </section>
</template>
