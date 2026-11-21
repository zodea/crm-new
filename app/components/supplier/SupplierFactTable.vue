<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type {
  SupplierContractDTO,
  SupplierInvoiceDTO,
  SupplierPaymentDTO,
  SupplierProjectDTO,
  SupplierSettlementDTO,
} from '~/lib/supplier/repository'
import SupplierRelationLink from '~/components/supplier/SupplierRelationLink.vue'
import { AUXILIARY_LABELS } from '~/lib/auxiliary-contract/contract'
import { approvalAmountLabel } from '~/lib/finance/approval-amount'
import { yuan } from '~/lib/util/money'

export type SupplierFactTab = 'projects' | 'contracts' | 'settlements' | 'invoices' | 'payments'

defineProps<{
  tab: SupplierFactTab
  projects: readonly SupplierProjectDTO[]
  contracts: readonly SupplierContractDTO[]
  settlements: readonly SupplierSettlementDTO[]
  invoices: readonly SupplierInvoiceDTO[]
  payments: readonly SupplierPaymentDTO[]
}>()

const projectColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'project', title: '合作项目', minWidth: 190, fixed: 'left', slot: 'project' },
  { field: 'relationshipStatus', title: '合作状态', width: 110 },
]
const contractColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'contract', title: '合同', minWidth: 220, fixed: 'left', slot: 'contract' },
  { field: 'project', title: '项目', minWidth: 170, slot: 'project' },
  { field: 'kind', title: '类别', width: 90, slot: 'contractKind' },
  { field: 'effectiveAmount', title: '有效合同额', type: 'money', width: 145 },
  { field: 'signDate', title: '签订日期', type: 'date' },
  { field: 'status', title: '状态', width: 100 },
]
const settlementColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'settlement', title: '结算单', minWidth: 210, fixed: 'left', slot: 'settlement' },
  { field: 'project', title: '项目', minWidth: 170, slot: 'project' },
  { field: 'contract', title: '合同', minWidth: 190, slot: 'contract' },
  { field: 'settlementType', title: '结算类型', width: 105 },
  { field: 'totalAmount', title: '结算金额', type: 'money', width: 135 },
  { field: 'settlementDate', title: '结算日期', type: 'date' },
  { field: 'status', title: '状态', width: 100 },
]
const invoiceColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'invoice', title: '发票号码', minWidth: 190, fixed: 'left', slot: 'invoice' },
  { field: 'project', title: '项目', minWidth: 170, slot: 'project' },
  { field: 'contract', title: '合同', minWidth: 190, slot: 'contract' },
  { field: 'invoiceType', title: '发票类型', width: 145 },
  { field: 'totalAmount', title: '价税合计', type: 'money', width: 135 },
  { field: 'taxAmount', title: '税额', type: 'money', width: 120 },
  { field: 'invoiceDate', title: '开票日期', type: 'date' },
]
const paymentColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'application', title: '付款申请', minWidth: 210, fixed: 'left', slot: 'application' },
  { field: 'project', title: '项目', minWidth: 170, slot: 'project' },
  { field: 'contract', title: '合同', minWidth: 190, slot: 'contract' },
  { field: 'applyAmount', title: '申请金额', type: 'money', width: 130 },
  { field: 'approvedAmount', title: '核准金额', width: 150, align: 'right', slot: 'approval' },
  { field: 'actualPaidAmount', title: '确认实付', type: 'money', width: 130 },
  { field: 'applyDate', title: '申请日期', type: 'date' },
  { field: 'status', title: '状态', width: 100 },
]
</script>

<template>
  <section class="min-w-0" role="tabpanel" tabindex="0" :aria-label="tab">
    <KitTable v-if="tab === 'projects'" :columns="projectColumns" :data="[...projects]" :min-rows="5" :empty="{ title: '暂无合作项目', description: '当前分供方尚未通过稳定 ID 关联项目。' }">
      <template #project="{ row }">
        <SupplierRelationLink :reference="row.project" :navigation="row.navigation" />
      </template>
    </KitTable>
    <KitTable v-else-if="tab === 'contracts'" :columns="contractColumns" :data="[...contracts]" :min-rows="5" :empty="{ title: '暂无合同事实', description: '当前分供方尚无通过 supplier_id 关联的合同。' }">
      <template #contractKind="{ row }">
        {{ AUXILIARY_LABELS[row.kind as keyof typeof AUXILIARY_LABELS] ?? row.kind ?? '—' }}
      </template>
      <template #contract="{ row }">
        <SupplierRelationLink :reference="row.contract" :navigation="row.navigation" />
      </template>
      <template #project="{ row }">
        <SupplierRelationLink :reference="row.project" :navigation="row.projectNavigation" />
      </template>
    </KitTable>
    <KitTable v-else-if="tab === 'settlements'" :columns="settlementColumns" :data="[...settlements]" :min-rows="5" :empty="{ title: '暂无结算事实', description: '当前分供方尚无已登记支出结算；不会从合同累计字段推算。' }">
      <template #settlement="{ row }">
        <SupplierRelationLink :reference="row.settlement" :navigation="row.navigation" />
      </template>
      <template #project="{ row }">
        <SupplierRelationLink :reference="row.project" :navigation="row.projectNavigation" />
      </template>
      <template #contract="{ row }">
        <SupplierRelationLink :reference="row.contract" :navigation="row.contractNavigation" />
      </template>
    </KitTable>
    <KitTable v-else-if="tab === 'invoices'" :columns="invoiceColumns" :data="[...invoices]" :min-rows="5" :empty="{ title: '暂无归档收票', description: '当前分供方尚无已归档发票；未归档票据不计入事实金额。' }">
      <template #invoice="{ row }">
        <SupplierRelationLink :reference="row.invoice" :navigation="row.navigation" />
      </template>
      <template #project="{ row }">
        <SupplierRelationLink :reference="row.project" :navigation="row.projectNavigation" />
      </template>
      <template #contract="{ row }">
        <SupplierRelationLink :reference="row.contract" :navigation="row.contractNavigation" />
      </template>
    </KitTable>
    <KitTable v-else :columns="paymentColumns" :data="[...payments]" :min-rows="5" :empty="{ title: '暂无付款事实', description: '当前分供方尚无确认付款分摊；不会从申请金额推算实付。' }">
      <template #approval="{ row }">
        <span class="block font-mono tabular-nums">{{ yuan(row.approvedAmount) }}</span>
        <span v-if="row.approvedAmount === null" class="text-10px text-ink-faint">{{ approvalAmountLabel(row.approvedAmountState) }}</span>
      </template>
      <template #application="{ row }">
        <SupplierRelationLink :reference="row.application" :navigation="row.navigation" />
      </template>
      <template #project="{ row }">
        <SupplierRelationLink :reference="row.project" :navigation="row.projectNavigation" />
      </template>
      <template #contract="{ row }">
        <SupplierRelationLink :reference="row.contract" :navigation="row.contractNavigation" />
      </template>
    </KitTable>
  </section>
</template>
