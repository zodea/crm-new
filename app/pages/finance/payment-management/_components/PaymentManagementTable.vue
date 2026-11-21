<script setup lang="ts">
import type { KitStatusTone } from '~/components/ui/KitStatusTag.vue'
import type { KitTableColumn } from '~/lib/kit/table'
import type { PaymentManagementRow } from '~/stores/payment-management'
import KitStatusTag from '~/components/ui/KitStatusTag.vue'
import { approvalAmountLabel } from '~/lib/finance/approval-amount'
import { yuan } from '~/lib/util/money'

defineProps<{
  rows: PaymentManagementRow[]
  loading: boolean
  page: number
  pageSize: number
  total: number
  canRegister?: boolean
}>()

const emit = defineEmits<{
  pageChange: [payload: { page: number, pageSize: number }]
  openApplication: [row: PaymentManagementRow]
  createPayment: [row: PaymentManagementRow]
}>()

const columns: KitTableColumn[] = [
  { title: '#', type: 'seq', width: 54, fixed: 'left' },
  {
    field: 'name',
    title: '付款申请',
    minWidth: 230,
    fixed: 'left',
    slot: 'application',
  },
  { field: 'projectName', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'supplierName', title: '收款单位', minWidth: 190, slot: 'supplier' },
  { field: 'bizType', title: '业务类型', width: 150 },
  { field: 'approvedAmount', title: '批复金额', width: 150, slot: 'approved', align: 'right' },
  { field: 'paidAmount', title: '已支付', type: 'money', width: 136 },
  { field: 'dueAmount', title: '应付余额', width: 136, align: 'right', slot: 'due' },
  { field: 'invoiceStatus', title: '回票状态', width: 104, slot: 'invoiceStatus' },
  { field: 'paymentStatus', title: '支付状态', width: 104, slot: 'paymentStatus' },
  { field: 'applyDate', title: '申请日期', type: 'date', width: 116 },
  { title: '操作', type: 'action', width: 56 },
]

const rowActions = [
  { key: 'application', label: '查看付款申请', icon: 'i-lucide-file-text' },
  { key: 'payment', label: '登记支付记录', icon: 'i-lucide-landmark' },
] as const

function paymentStatusTone(status: PaymentManagementRow['paymentStatus']): KitStatusTone {
  if (status === '已付清')
    return 'ok'
  if (status === '部分支付')
    return 'brand'
  if (status === '超额支付')
    return 'danger'
  return 'warn'
}

function invoiceStatusTone(status: PaymentManagementRow['invoiceStatus']): KitStatusTone {
  if (status === '已回票' || status === '无需发票' || status === '已关联')
    return 'ok'
  if (status === '部分回票' || status === '部分关联')
    return 'brand'
  return 'warn'
}

function handleAction(action: string, row: PaymentManagementRow) {
  if (action === 'application')
    emit('openApplication', row)
  else if (action === 'payment')
    emit('createPayment', row)
}
</script>

<template>
  <div data-testid="payment-management-table" class="min-w-0 max-w-full">
    <KitTable
      :columns="columns"
      :data="rows"
      :loading="loading"
      :page="{ page, pageSize, total }"
      :empty="{
        title: '当前范围没有付款申请',
        description: '本工作台只展示已批复申请；审批中的申请请到付款申请页面处理。',
      }"
      @page-change="emit('pageChange', $event)"
    >
      <template #application="{ row }">
        <KitButton
          variant="ghost"
          class="cell--link h-auto flex-col items-start justify-start gap-0 border-0 p-0 text-left"
          @click="emit('openApplication', row)"
        >
          <span class="block font-700">{{ row.name || '未命名申请' }}</span>
          <span class="mt-0.5 block font-mono text-11px text-ink-faint">{{ row.no || '未编号' }}</span>
        </KitButton>
      </template>

      <template #project="{ row }">
        <NuxtLink v-if="row.projectId" :to="`/project/${row.projectId}`" class="cell--link">
          {{ row.projectName }}
        </NuxtLink>
        <span v-else>{{ row.projectName }}</span>
      </template>

      <template #supplier="{ row }">
        <NuxtLink v-if="row.supplierId" :to="`/base/supplier/${row.supplierId}`" class="cell--link">
          {{ row.supplierName }}
        </NuxtLink>
        <span v-else>{{ row.supplierName }}</span>
      </template>

      <template #due="{ row }">
        <span
          class="font-mono font-700 tabular-nums"
          :class="(row.dueAmount ?? 0) > 0 ? 'text-danger-ink' : 'text-ink'"
        >
          {{ yuan(row.dueAmount) }}
        </span>
      </template>

      <template #approved="{ row }">
        <span class="block font-mono tabular-nums">{{ yuan(row.approvedAmount) }}</span>
        <span v-if="row.approvedAmount === null" class="text-10px text-ink-faint">{{ approvalAmountLabel(row.approvedAmountState) }}</span>
      </template>

      <template #invoiceStatus="{ row }">
        <KitStatusTag :tone="invoiceStatusTone(row.invoiceStatus)">
          {{ row.invoiceStatus }}
        </KitStatusTag>
      </template>

      <template #paymentStatus="{ row }">
        <KitStatusTag :tone="paymentStatusTone(row.paymentStatus)">
          {{ row.paymentStatus }}
        </KitStatusTag>
      </template>

      <template #action="{ row }">
        <RowActionMenu
          :items="canRegister !== false && row.canRegisterPayment !== false && row.dueAmount !== null ? rowActions : rowActions.filter(action => action.key !== 'payment')"
          :label="`${row.name || row.no}付款操作`"
          @select="handleAction($event, row)"
        />
      </template>
    </KitTable>
  </div>
</template>
