<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import { PROJECT_DETAIL_TABS, projectArchivedInvoices } from '~/lib/project/subtables'

const props = defineProps<{
  tab: string
  projectId: string
}>()

const detailStore = useProjectDetailStore()
const invoiceStore = useInvoiceStore()

const constructionContracts = computed(() =>
  detailStore.constructionContracts.filter(row => row.projectId === props.projectId),
)
const supplementAgreements = computed(() =>
  detailStore.supplementAgreements.filter(row => row.projectId === props.projectId),
)
const ownerChangeOrders = computed(() =>
  detailStore.ownerChangeOrders.filter(row => row.projectId === props.projectId),
)
const invoiceApplications = computed(() =>
  detailStore.invoiceApplications.filter(row => row.projectId === props.projectId),
)
const receivedInvoices = computed(() =>
  projectArchivedInvoices(invoiceStore.list, props.projectId),
)
const receiptRegistrations = computed(() =>
  detailStore.receiptRegistrations.filter(row => row.projectId === props.projectId),
)
const paymentApplications = computed(() =>
  detailStore.paymentApplications.filter(row => row.projectId === props.projectId),
)

const placeholder = computed(() =>
  PROJECT_DETAIL_TABS.find(tab => tab.key === props.tab && tab.kind === 'placeholder'),
)

const constructionColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '合同名称', minWidth: 220 },
  { field: 'contractNo', title: '合同编号', width: 180 },
  { field: 'category', title: '合同类别', width: 110 },
  { field: 'amount', title: '含税合同金额', type: 'money', width: 150 },
  { field: 'status', title: '合同状态', width: 100 },
  { field: 'signDate', title: '签约日期', type: 'date' },
]
const supplementColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '协议名称', minWidth: 240 },
  { field: 'amount', title: '协议金额', type: 'money', width: 140 },
  { field: 'signDate', title: '签约日期', type: 'date' },
]
const changeColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'changeNo', title: '变更编号', width: 140 },
  { field: 'contractName', title: '合同名称', minWidth: 220 },
  { field: 'taxIncAmount', title: '含税审定金额', type: 'money', width: 150 },
  { field: 'taxExcAmount', title: '不含税审定金额', type: 'money', width: 160 },
  { field: 'appliedAmount', title: '已申请金额', type: 'money', width: 140 },
  { field: 'approvalDate', title: '审定日期', type: 'date' },
]
const invoiceApplicationColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '开票申请名称', minWidth: 240 },
  { field: 'amount', title: '开票金额', type: 'money', width: 140 },
  { field: 'taxRate', title: '税率(%)', width: 90, align: 'right' },
  { field: 'taxAmount', title: '税额', type: 'money', width: 130 },
  { field: 'status', title: '审核状态', width: 100 },
  { field: 'invoiceDate', title: '开票日期', type: 'date' },
]
const receivedInvoiceColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'invoiceNumber', title: '发票号码', minWidth: 170 },
  { field: 'seller', title: '销方名称', minWidth: 200 },
  { field: 'totalAmount', title: '价税合计', type: 'money', width: 140 },
  { field: 'taxAmount', title: '税额', type: 'money', width: 120 },
  { field: 'invoiceType', title: '发票类型', minWidth: 150 },
  { field: 'invoiceDate', title: '开票日期', type: 'date' },
]
const receiptColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'receiptNo', title: '收款编号', width: 150 },
  { field: 'receiptDate', title: '收款日期', type: 'date' },
  { field: 'amount', title: '收款金额', type: 'money', width: 150 },
  { field: 'paymentMethod', title: '支付方式', width: 110 },
  { field: 'payerUnit', title: '支付单位', minWidth: 200 },
  { field: 'cumulativeReceivable', title: '累计应收', type: 'money', width: 150 },
]
const paymentColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'applicationNo', title: '付款编号', width: 150 },
  { field: 'approvalStatus', title: '审批状态', width: 100 },
  { field: 'applicant', title: '申请人', width: 100 },
  { field: 'amount', title: '申请金额', type: 'money', width: 140 },
  { field: 'paidAmount', title: '已付金额', type: 'money', width: 140 },
  { field: 'actualPayment', title: '实际支付', type: 'money', width: 140 },
  { field: 'paymentMethod', title: '支付方式', width: 110 },
]

onMounted(() => Promise.all([
  detailStore.load(),
  invoiceStore.load(),
]))
</script>

<template>
  <div v-if="tab === 'construction'" class="space-y-5">
    <ProjectSubTableSection
      title="施工合同"
      :columns="constructionColumns"
      :rows="constructionContracts"
      :loading="detailStore.loading"
    />
    <ProjectSubTableSection
      title="补充协议"
      :columns="supplementColumns"
      :rows="supplementAgreements"
      :loading="detailStore.loading"
    />
    <ProjectSubTableSection
      title="甲方变洽签"
      :columns="changeColumns"
      :rows="ownerChangeOrders"
      :loading="detailStore.loading"
    />
  </div>

  <div v-else-if="tab === 'tax'" class="space-y-5">
    <ProjectSubTableSection
      title="开票申请"
      :columns="invoiceApplicationColumns"
      :rows="invoiceApplications"
      :loading="detailStore.loading"
    />
    <ProjectSubTableSection
      title="收票登记"
      :columns="receivedInvoiceColumns"
      :rows="receivedInvoices"
      :loading="invoiceStore.loading"
    />
  </div>

  <div v-else-if="tab === 'fund'" class="space-y-5">
    <ProjectSubTableSection
      title="收款登记"
      :columns="receiptColumns"
      :rows="receiptRegistrations"
      :loading="detailStore.loading"
    />
    <ProjectSubTableSection
      title="付款申请"
      :columns="paymentColumns"
      :rows="paymentApplications"
      :loading="detailStore.loading"
    />
  </div>

  <div
    v-else-if="placeholder"
    class="flex min-h-56 flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-panel px-6 py-12 text-center shadow-[var(--shadow-card)]"
  >
    <span class="i-lucide-panels-top-left mb-3 h-8 w-8 text-brand" aria-hidden="true" />
    <h3 class="text-15px text-ink font-700">
      {{ placeholder.label }}
    </h3>
    <p class="mt-1.5 max-w-120 text-12px leading-5 text-ink-faint">
      页面框架已预留，该模块将在后续业务波次接入真实数据与操作能力。
    </p>
    <span class="chip mt-4 bg-surface-3 text-ink-soft">待建设</span>
  </div>
</template>
