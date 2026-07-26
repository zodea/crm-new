<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'

const props = defineProps<{
  tab: string
  projectId: string
}>()

const detailStore = useProjectDetailStore()

const targetCosts = computed(() =>
  detailStore.targetCosts.filter(row => row.projectId === props.projectId),
)
const targetCostCategories = computed(() =>
  detailStore.targetCostCategories.filter(row => row.projectId === props.projectId),
)
const expenditureContracts = computed(() =>
  detailStore.expenditureContracts.filter(row => row.projectId === props.projectId),
)
const expenditureSupplements = computed(() =>
  detailStore.expenditureSupplements.filter(row => row.projectId === props.projectId),
)
const subcontractChanges = computed(() =>
  detailStore.subcontractChanges.filter(row => row.projectId === props.projectId),
)
const expenditureSettlements = computed(() =>
  detailStore.expenditureSettlements.filter(row => row.projectId === props.projectId),
)
const currentReceipts = computed(() =>
  detailStore.currentReceipts.filter(row => row.projectId === props.projectId),
)
const currentPayments = computed(() =>
  detailStore.currentPayments.filter(row => row.projectId === props.projectId),
)
const paymentRecords = computed(() =>
  detailStore.paymentRecords.filter(row => row.projectId === props.projectId),
)

const targetCostColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '目标成本版本', minWidth: 220, slot: 'link' },
  { field: 'status', title: '控制状态', width: 130, filterable: true },
  { field: 'targetAmount', title: '目标成本', type: 'money', width: 145 },
  { field: 'signedAmount', title: '已签合同', type: 'money', width: 145 },
  { field: 'settledAmount', title: '累计结算', type: 'money', width: 145 },
  { field: 'paidAmount', title: '累计支付', type: 'money', width: 145 },
  { field: 'remainingAmount', title: '目标余量', type: 'money', width: 145 },
]
const targetCategoryColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'category', title: '成本分类', minWidth: 130, filterable: true },
  { field: 'targetAmount', title: '目标成本', type: 'money', width: 145 },
  { field: 'signedAmount', title: '已签合同', type: 'money', width: 145 },
  { field: 'settledAmount', title: '累计结算', type: 'money', width: 145 },
  { field: 'paidAmount', title: '累计支付', type: 'money', width: 145 },
  { field: 'remainingAmount', title: '目标余量', type: 'money', width: 145 },
  { field: 'source', title: '来源', minWidth: 280, slot: 'source' },
]
const expenditureContractColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '合同名称', minWidth: 230, slot: 'link' },
  { field: 'contractNo', title: '合同编号', width: 180 },
  { field: 'category', title: '合同类别', width: 110, filterable: true },
  { field: 'originalCategory', title: '原始细类', width: 110, filterable: true },
  { field: 'classificationState', title: '分类状态', width: 110, filterable: true },
  { field: 'status', title: '合同状态', width: 100, filterable: true },
  { field: 'amount', title: '主合同含税金额', type: 'money', width: 155 },
  { field: 'supplementAmount', title: '有效补充协议', type: 'money', width: 155 },
  { field: 'supplier', title: '分供方', minWidth: 180, filterable: true },
  { field: 'effectiveDate', title: '生效日期', type: 'date' },
  { field: 'settledAmount', title: '累计正式结算', type: 'money', width: 155 },
  { field: 'paidAmount', title: '累计确认支付', type: 'money', width: 155 },
]
const expenditureSupplementColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '协议名称', minWidth: 220, slot: 'link' },
  { field: 'agreementNo', title: '协议编号', width: 170 },
  { field: 'contractName', title: '关联合同', minWidth: 220, filterable: true },
  { field: 'amount', title: '协议金额', type: 'money', width: 145 },
  { field: 'signDate', title: '签约日期', type: 'date' },
  { field: 'status', title: '状态', width: 100, filterable: true },
]
const subcontractChangeColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'changeNo', title: '变更编号', width: 160, slot: 'link' },
  { field: 'changeType', title: '变更类型', width: 120, filterable: true },
  { field: 'supplier', title: '乙方', minWidth: 170, filterable: true },
  { field: 'contractName', title: '合同名称', minWidth: 220 },
  { field: 'approvedAmount', title: '审批金额', type: 'money', width: 145 },
  { field: 'changedArea', title: '变更面积', width: 120, align: 'right' },
  { field: 'actualApprovedPrice', title: '实际审定价', type: 'money', width: 145 },
  { field: 'status', title: '合约审批', width: 110, filterable: true },
]
const expenditureSettlementColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '结算名称', minWidth: 220, slot: 'link' },
  { field: 'settlementNo', title: '结算编号', width: 160 },
  { field: 'contractName', title: '合同名称', minWidth: 220, filterable: true },
  { field: 'settlementDate', title: '结算日期', type: 'date' },
  { field: 'settlementType', title: '结算类型', width: 130, filterable: true },
  { field: 'amount', title: '结算金额', type: 'money', width: 145 },
  { field: 'status', title: '状态', width: 100, filterable: true },
]
const currentReceiptColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'documentNo', title: '往来收款编号', width: 170, slot: 'link' },
  { field: 'transactionDate', title: '收款日期', type: 'date' },
  { field: 'counterparty', title: '付款方', minWidth: 190, filterable: true },
  { field: 'purpose', title: '用途', minWidth: 190 },
  { field: 'amount', title: '收款金额', type: 'money', width: 150 },
  { field: 'paymentMethod', title: '支付方式', width: 120, filterable: true },
  { field: 'bankSerialNo', title: '银行流水', width: 170 },
  { field: 'handler', title: '经办人', width: 110, filterable: true },
  { field: 'status', title: '状态', width: 100, filterable: true },
]
const currentPaymentColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'documentNo', title: '往来付款编号', width: 170, slot: 'link' },
  { field: 'transactionDate', title: '付款日期', type: 'date' },
  { field: 'counterparty', title: '收款方', minWidth: 190, filterable: true },
  { field: 'purpose', title: '用途', minWidth: 190 },
  { field: 'amount', title: '付款金额', type: 'money', width: 150 },
  { field: 'paymentMethod', title: '支付方式', width: 120, filterable: true },
  { field: 'bankSerialNo', title: '银行流水', width: 170 },
  { field: 'handler', title: '经办人', width: 110, filterable: true },
  { field: 'status', title: '状态', width: 100, filterable: true },
]
const paymentRecordColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'paymentNo', title: '支付编号', width: 160, slot: 'link' },
  { field: 'paymentDate', title: '支付日期', type: 'date' },
  { field: 'payee', title: '收款方', minWidth: 190, filterable: true },
  { field: 'purpose', title: '用途', minWidth: 210 },
  { field: 'amount', title: '支付金额', type: 'money', width: 150 },
  { field: 'paymentMethod', title: '支付方式', width: 120, filterable: true },
  { field: 'voucherNo', title: '凭证号', width: 160 },
  { field: 'bankSerialNo', title: '银行流水号', width: 170 },
  { field: 'handler', title: '经办/确认人', width: 120, filterable: true },
  { field: 'status', title: '确认状态', width: 110, filterable: true },
  { field: 'source', title: '识别来源', width: 110, filterable: true },
  { field: 'recognitionStatus', title: '识别状态', width: 110, filterable: true },
  { field: 'allocationCount', title: '分摊申请数', width: 110, align: 'right' },
  { field: 'allocatedAmount', title: '已分摊', type: 'money', width: 140 },
  { field: 'allocationDifference', title: '分摊差额', type: 'money', width: 140 },
]
</script>

<template>
  <div v-if="tab === 'budget'" class="space-y-5">
    <ProjectSubTableSection
      title="目标成本版本"
      :columns="targetCostColumns"
      :rows="targetCosts"
      :loading="detailStore.loading"
      empty="当前项目尚未建立目标成本版本"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.name || '查看目标成本' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>

    <ProjectSubTableSection
      title="目标成本分类控制"
      :columns="targetCategoryColumns"
      :rows="targetCostCategories"
      :loading="detailStore.loading"
      :summary-fields="[
        { field: 'targetAmount', label: '目标成本合计' },
        { field: 'signedAmount', label: '已签合同合计' },
        { field: 'settledAmount', label: '累计结算合计' },
        { field: 'paidAmount', label: '累计支付合计' },
      ]"
      empty="当前项目尚无正式目标成本或成本事实"
    >
      <template #source="{ row }">
        <div class="flex flex-wrap gap-1">
          <NuxtLink v-if="row.targetLineCount" :to="row.targetPath" class="cell--link">
            目标 {{ row.targetLineCount }}
          </NuxtLink>
          <NuxtLink v-if="row.contractCount" :to="row.contractPath" class="cell--link">
            合同 {{ row.contractCount }}
          </NuxtLink>
          <NuxtLink v-if="row.settlementCount" :to="row.settlementPath" class="cell--link">
            结算 {{ row.settlementCount }}
          </NuxtLink>
          <NuxtLink v-if="row.paymentCount" :to="row.paymentPath" class="cell--link">
            支付 {{ row.paymentCount }}
          </NuxtLink>
          <NuxtLink v-if="row.reimbursementCount" :to="row.reimbursementPath" class="cell--link">
            报销 {{ row.reimbursementCount }}
          </NuxtLink>
          <span
            v-if="!(
              row.targetLineCount
              || row.contractCount
              || row.settlementCount
              || row.paymentCount
              || row.reimbursementCount
            )"
            class="text-ink-faint"
          >
            —
          </span>
        </div>
      </template>
    </ProjectSubTableSection>
  </div>

  <div v-else-if="tab === 'expenditure'" class="space-y-5">
    <ProjectSubTableSection
      title="支出合同"
      :columns="expenditureContractColumns"
      :rows="expenditureContracts"
      :loading="detailStore.loading"
      :summary-fields="[
        { field: 'amount', label: '主合同合计' },
        { field: 'supplementAmount', label: '有效补充协议合计' },
        { field: 'settledAmount', label: '正式结算合计' },
        { field: 'paidAmount', label: '确认支付合计' },
      ]"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.name || row.contractNo || '查看合同' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>

    <ProjectSubTableSection
      title="支出合同补充协议"
      :columns="expenditureSupplementColumns"
      :rows="expenditureSupplements"
      :loading="detailStore.loading"
      :summary-fields="[{ field: 'effectiveAmount', label: '有效协议金额合计' }]"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.name || row.agreementNo || '查看关联合同' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>

    <ProjectSubTableSection
      title="分包变洽签"
      :columns="subcontractChangeColumns"
      :rows="subcontractChanges"
      :loading="detailStore.loading"
      :summary-fields="[{ field: 'effectiveApprovedAmount', label: '正式审批金额合计' }]"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.changeNo || '查看分包变洽签' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>

    <ProjectSubTableSection
      title="支出结算"
      :columns="expenditureSettlementColumns"
      :rows="expenditureSettlements"
      :loading="detailStore.loading"
      :summary-fields="[{ field: 'effectiveAmount', label: '正式结算金额合计' }]"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.name || row.settlementNo || '查看支出结算' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>
  </div>

  <div v-else-if="tab === 'current'" class="space-y-5">
    <ProjectSubTableSection
      title="往来收款"
      :columns="currentReceiptColumns"
      :rows="currentReceipts"
      :loading="detailStore.loading"
      :summary-fields="[{ field: 'effectiveAmount', label: '正式往来收款合计' }]"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.documentNo || '查看往来收款' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>
    <ProjectSubTableSection
      title="往来付款"
      :columns="currentPaymentColumns"
      :rows="currentPayments"
      :loading="detailStore.loading"
      :summary-fields="[{ field: 'effectiveAmount', label: '正式往来付款合计' }]"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.documentNo || '查看往来付款' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>
  </div>

  <ProjectSubTableSection
    v-else-if="tab === 'payment'"
    title="支付记录"
    :columns="paymentRecordColumns"
    :rows="paymentRecords"
    :loading="detailStore.loading"
    :summary-fields="[{ field: 'effectiveAmount', label: '确认支付合计' }]"
  >
    <template #link="{ row }">
      <NuxtLink :to="row.sourcePath" class="cell--link">
        {{ row.paymentNo || '查看支付记录' }}
      </NuxtLink>
    </template>
  </ProjectSubTableSection>
</template>
