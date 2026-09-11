<script setup lang="ts">
import type {
  CustomerContractDTO,
  CustomerProjectDTO,
  CustomerReceiptDTO,
} from '~/lib/customer/repository'
import type { KitTableColumn } from '~/lib/kit/table'
import type { ProblemDTO } from '~/types/read-model'
import { financeStatusLabel, financeStatusTone } from '~/lib/finance/status'
import CustomerRelationLink from './CustomerRelationLink.vue'

export type CustomerRelationTab = 'projects' | 'contracts' | 'receipts'

defineProps<{
  tab: CustomerRelationTab
  projects: readonly CustomerProjectDTO[]
  projectsProblem?: ProblemDTO
  contractsProblem?: ProblemDTO
  receiptsProblem?: ProblemDTO
  restoreScrollLeft?: number
  contracts: readonly CustomerContractDTO[]
  receipts: readonly CustomerReceiptDTO[]
  relationshipReturnTo?: string
  returnTo?: string
  returnContext?: string
}>()

defineEmits<{ retryProjects: [], retryContracts: [], retryReceipts: [], viewRestored: [] }>()

const projectColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'project', title: '项目名称', minWidth: 180, fixed: 'left', slot: 'project' },
  { field: 'code', title: '项目编码', width: 130 },
  { field: 'relationRole', title: '客户关系', width: 90, slot: 'relation' },
  { field: 'status', title: '状态', width: 90 },
  { field: 'manager', title: '项目经理', width: 100 },
  { field: 'startDate', title: '开工日期', type: 'date' },
  { field: 'plannedEnd', title: '计划完成', type: 'date' },
  { field: 'contractCount', title: '施工合同', width: 90 },
  { field: 'effectiveContractAmount', title: '有效合同额', type: 'money', width: 145 },
  { field: 'effectiveReceiptAmount', title: '有效收款', type: 'money', width: 135 },
]

const contractColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'contract', title: '施工合同', minWidth: 210, fixed: 'left', slot: 'contract' },
  { field: 'project', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'effectiveAmount', title: '有效合同额', type: 'money', width: 145 },
  { field: 'receiptAmount', title: '累计收款', type: 'money', width: 135 },
  { field: 'outstandingAmount', title: '待收余额', type: 'money', width: 135 },
  { field: 'signDate', title: '签订日期', type: 'date' },
  { field: 'status', title: '状态', width: 95, slot: 'status' },
]

const receiptColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'receipt', title: '收款单号', width: 170, fixed: 'left', slot: 'receipt' },
  { field: 'receiptDate', title: '收款日期', type: 'date' },
  { field: 'project', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'contract', title: '施工合同', minWidth: 190, slot: 'contract' },
  { field: 'payerAccount', title: '付款账户', minWidth: 170 },
  { field: 'amount', title: '登记金额', type: 'money', width: 130 },
  { field: 'paymentMethod', title: '收款方式', width: 105 },
  { field: 'status', title: '状态', width: 95, slot: 'status' },
]
</script>

<template>
  <section
    class="min-w-0"
    role="tabpanel"
    tabindex="0"
    :aria-label="tab === 'projects' ? '名下项目' : tab === 'contracts' ? '施工合同' : '收款明细'"
  >
    <StatePanel
      v-if="tab === 'projects' && projectsProblem"
      :kind="projectsProblem.code === 'forbidden' ? 'forbidden' : 'error'"
      :title="projectsProblem.code === 'forbidden' ? '无权查看关联项目' : '关联项目加载失败'"
      :description="projectsProblem.message"
      :action-label="projectsProblem.retryable ? '重新加载关联项目' : ''"
      @action="$emit('retryProjects')"
    />
    <KitTable
      v-else-if="tab === 'projects'"
      :columns="projectColumns"
      :data="[...projects]"
      :min-rows="5"
      :restore-scroll-left="restoreScrollLeft"
      :empty="{ title: '暂无名下项目', description: '当前客户尚未通过主客户或次客户字段关联项目。' }"
      @view-restored="$emit('viewRestored')"
    >
      <template #project="{ row }">
        <CustomerRelationLink :reference="row.project" :navigation="row.navigation" :return-to="relationshipReturnTo" />
      </template>
      <template #relation="{ row }">
        <span :class="row.relationRole === '主客户' ? 'chip chip-brand' : 'chip'">{{ row.relationRole }}</span>
      </template>
    </KitTable>

    <StatePanel
      v-else-if="tab === 'contracts' && contractsProblem"
      :kind="contractsProblem.code === 'forbidden' ? 'forbidden' : 'error'"
      :title="contractsProblem.code === 'forbidden' ? '无权查看施工合同' : '施工合同加载失败'"
      :description="contractsProblem.message"
      :action-label="contractsProblem.retryable ? '重新加载施工合同' : ''"
      @action="$emit('retryContracts')"
    />
    <KitTable
      v-else-if="tab === 'contracts'"
      :columns="contractColumns"
      :data="[...contracts]"
      :min-rows="5"
      :restore-scroll-left="restoreScrollLeft"
      :empty="{ title: '暂无施工合同', description: '当前客户尚未关联可查看的施工合同。' }"
      @view-restored="$emit('viewRestored')"
    >
      <template #contract="{ row }">
        <CustomerRelationLink :reference="row.contract" :navigation="row.navigation" :return-to="relationshipReturnTo" />
      </template>
      <template #project="{ row }">
        <CustomerRelationLink :reference="row.project" :navigation="row.projectNavigation" :return-to="relationshipReturnTo" :return-anchor="row.contract.id ? `contract:${encodeURIComponent(row.contract.id)}` : null" />
      </template>
      <template #status="{ row }">
        <span :class="row.isDraft ? 'chip chip-warn' : 'chip chip-brand'">{{ row.status || '—' }}</span>
      </template>
    </KitTable>

    <StatePanel
      v-else-if="receiptsProblem"
      :kind="receiptsProblem.code === 'forbidden' ? 'forbidden' : 'error'"
      :title="receiptsProblem.code === 'forbidden' ? '无权查看收款明细' : '收款明细加载失败'"
      :description="receiptsProblem.message"
      :action-label="receiptsProblem.retryable ? '重新加载收款明细' : ''"
      @action="$emit('retryReceipts')"
    />
    <KitTable
      v-else
      :columns="receiptColumns"
      :data="[...receipts]"
      :min-rows="5"
      :restore-scroll-left="restoreScrollLeft"
      :empty="{ title: '暂无收款记录', description: '当前客户尚未登记收款；不会从合同金额推算收款。' }"
      @view-restored="$emit('viewRestored')"
    >
      <template #receipt="{ row }">
        <CustomerRelationLink
          :reference="row.receipt"
          :navigation="row.navigation"
          :return-to="relationshipReturnTo"
          :return-context="returnContext"
        />
      </template>
      <template #project="{ row }">
        <CustomerRelationLink :reference="row.project" :navigation="row.projectNavigation" :return-to="relationshipReturnTo" :return-anchor="row.receipt.id ? `receipt:${encodeURIComponent(row.receipt.id)}` : null" />
      </template>
      <template #contract="{ row }">
        <CustomerRelationLink :reference="row.contract" :navigation="row.contractNavigation" />
      </template>
      <template #status="{ row }">
        <KitStatusTag :tone="financeStatusTone(row.status)">
          {{ financeStatusLabel(row.status) }}
        </KitStatusTag>
      </template>
    </KitTable>
  </section>
</template>
