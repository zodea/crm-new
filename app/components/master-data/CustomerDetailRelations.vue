<script setup lang="ts">
import type {
  CustomerContractSummary,
  CustomerProjectSummary,
  CustomerReceiptSummary,
} from '~/lib/customer/detail'
import type { KitTableColumn } from '~/lib/kit/table'

export type CustomerRelationTab = 'projects' | 'contracts' | 'receipts'

defineProps<{
  tab: CustomerRelationTab
  projects: readonly CustomerProjectSummary[]
  contracts: readonly CustomerContractSummary[]
  receipts: readonly CustomerReceiptSummary[]
}>()

const projectColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'name', title: '项目名称', minWidth: 180, fixed: 'left', slot: 'project' },
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
  { field: 'name', title: '施工合同', minWidth: 210, fixed: 'left', slot: 'contract' },
  { field: 'no', title: '合同编号', width: 180 },
  { field: 'projectName', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'effectiveAmount', title: '有效合同额', type: 'money', width: 145 },
  { field: 'receiptAmount', title: '累计收款', type: 'money', width: 135 },
  { field: 'outstandingAmount', title: '待收余额', type: 'money', width: 135 },
  { field: 'signDate', title: '签订日期', type: 'date' },
  { field: 'status', title: '状态', width: 95, slot: 'status' },
]

const receiptColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'no', title: '收款单号', width: 170, fixed: 'left', slot: 'receipt' },
  { field: 'receiptDate', title: '收款日期', type: 'date' },
  { field: 'projectName', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'contractName', title: '施工合同', minWidth: 190, slot: 'contract' },
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
    <KitTable
      v-if="tab === 'projects'"
      :columns="projectColumns"
      :data="[...projects]"
      :min-rows="5"
      :empty="{ title: '暂无名下项目', description: '当前客户尚未通过主客户或次客户字段关联项目。' }"
    >
      <template #project="{ row }">
        <NuxtLink
          :to="`/project/${row.id}`"
          class="cell--link block max-w-full truncate"
          :title="row.name || row.id"
        >
          {{ row.name || row.id }}
        </NuxtLink>
      </template>
      <template #relation="{ row }">
        <span :class="row.relationRole === '主客户' ? 'chip chip-brand' : 'chip'">{{ row.relationRole }}</span>
      </template>
    </KitTable>

    <KitTable
      v-else-if="tab === 'contracts'"
      :columns="contractColumns"
      :data="[...contracts]"
      :min-rows="5"
      :empty="{ title: '暂无施工合同', description: '仅展示 customer_id 指向当前客户的施工合同。' }"
    >
      <template #contract="{ row }">
        <NuxtLink
          :to="`/contract/${row.id}`"
          class="cell--link block max-w-full truncate"
          :title="row.name || row.no || row.id"
        >
          {{ row.name || row.no || row.id }}
        </NuxtLink>
      </template>
      <template #project="{ row }">
        <NuxtLink
          v-if="row.projectId"
          :to="`/project/${row.projectId}`"
          class="cell--link block max-w-full truncate"
          :title="row.projectName || row.projectId"
        >
          {{ row.projectName || row.projectId }}
        </NuxtLink>
        <span v-else>—</span>
      </template>
      <template #status="{ row }">
        <span :class="row.isDraft ? 'chip chip-warn' : 'chip chip-brand'">{{ row.status || '—' }}</span>
      </template>
    </KitTable>

    <KitTable
      v-else
      :columns="receiptColumns"
      :data="[...receipts]"
      :min-rows="5"
      :empty="{ title: '暂无收款记录', description: '当前客户尚未登记收款；不会从合同金额推算收款。' }"
    >
      <template #receipt="{ row }">
        <NuxtLink
          :to="`/finance/receipt/${row.id}`"
          class="cell--link block max-w-full truncate font-mono"
          :title="row.no || row.id"
        >
          {{ row.no || row.id }}
        </NuxtLink>
      </template>
      <template #project="{ row }">
        <NuxtLink
          v-if="row.projectId"
          :to="`/project/${row.projectId}`"
          class="cell--link block max-w-full truncate"
          :title="row.projectName || row.projectId"
        >
          {{ row.projectName || row.projectId }}
        </NuxtLink>
        <span v-else>—</span>
      </template>
      <template #contract="{ row }">
        <NuxtLink
          v-if="row.contractId"
          :to="`/contract/${row.contractId}`"
          class="cell--link block max-w-full truncate"
          :title="row.contractName || row.contractId"
        >
          {{ row.contractName || row.contractId }}
        </NuxtLink>
        <span v-else>—</span>
      </template>
      <template #status="{ row }">
        <span :class="row.isDraft ? 'chip chip-warn' : 'chip chip-ok'">{{ row.status || '—' }}</span>
      </template>
    </KitTable>
  </section>
</template>
