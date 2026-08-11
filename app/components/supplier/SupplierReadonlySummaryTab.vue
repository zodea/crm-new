<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { SupplierDetailSnapshot } from '~/stores/supplier-detail'
import { yuan } from '~/lib/util/money'

type SummaryTab = 'projects' | 'contracts' | 'payments' | 'invoices'

const props = defineProps<{
  supplierId: string
  tab: SummaryTab
  snapshot: SupplierDetailSnapshot
}>()

const projectColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'projectName', title: '项目', minWidth: 180, fixed: 'left', slot: 'project' },
  { field: 'relationshipStatus', title: '合作状态', width: 105, slot: 'relationshipStatus' },
  { field: 'contractCount', title: '合同数', width: 80 },
  { field: 'contractTotal', title: '合同额', type: 'money', width: 135 },
  { field: 'paidTotal', title: '已付', type: 'money', width: 135 },
  { field: 'payableBalance', title: '应付余额', width: 135, align: 'right', slot: 'balance' },
  { field: 'settlementStatus', title: '结算状态', width: 105, slot: 'settlementStatus' },
]

const contractColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'name', title: '合同名称', minWidth: 190, fixed: 'left', slot: 'contract' },
  { field: 'no', title: '合同编号', width: 175 },
  { field: 'kind', title: '类型', width: 85 },
  { field: 'projectName', title: '项目', minWidth: 155, slot: 'project' },
  { field: 'amount', title: '含税金额', type: 'money', width: 135 },
  { field: 'paid', title: '累计支付', type: 'money', width: 135 },
  { field: 'signDate', title: '签订日期', width: 115 },
  { field: 'status', title: '状态', width: 95, slot: 'status' },
]

const paymentColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'applicationNo', title: '申请编号', width: 160, fixed: 'left', slot: 'payment' },
  { field: 'name', title: '请款名称', minWidth: 180 },
  { field: 'projectName', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'amount', title: '申请金额', type: 'money', width: 130 },
  { field: 'approvedAmount', title: '审批金额', type: 'money', width: 130 },
  { field: 'actualPayment', title: '实际付款', type: 'money', width: 130 },
  { field: 'createdAt', title: '申请时间', width: 120, slot: 'date' },
  { field: 'paymentStatus', title: '状态', width: 95, slot: 'status' },
]

const invoiceColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'invoiceNumber', title: '发票号码', width: 190, fixed: 'left', slot: 'invoice' },
  { field: 'invoiceType', title: '票据类型', width: 130 },
  { field: 'projectName', title: '项目', minWidth: 160, slot: 'project' },
  { field: 'totalAmount', title: '价税合计', type: 'money', width: 135 },
  { field: 'taxAmount', title: '税额', type: 'money', width: 120 },
  { field: 'invoiceDate', title: '开票日期', width: 115 },
]

const contractKind = shallowRef('all')
const contractOrder = shallowRef<'desc' | 'asc'>('desc')
const paymentOrder = shallowRef<'date' | 'amount'>('date')
const invoiceSearch = shallowRef('')

const projectRows = computed(() => [...props.snapshot.projects])
const contractKinds = computed(() => [...new Set(props.snapshot.contracts.map(row => row.kind).filter(Boolean))])
const visibleContracts = computed(() => {
  const rows = contractKind.value === 'all'
    ? [...props.snapshot.contracts]
    : props.snapshot.contracts.filter(row => row.kind === contractKind.value)
  return rows.sort((a, b) => contractOrder.value === 'desc' ? b.amount - a.amount : a.amount - b.amount)
})
const visiblePayments = computed(() => [...props.snapshot.payments].sort((a, b) =>
  paymentOrder.value === 'amount'
    ? b.approvedAmount - a.approvedAmount
    : b.createdAt.localeCompare(a.createdAt),
))
const visibleInvoices = computed(() => {
  const keyword = invoiceSearch.value.trim().toLowerCase()
  if (!keyword)
    return [...props.snapshot.invoices]
  return props.snapshot.invoices.filter(row =>
    [
      row.invoiceNumber,
      row.invoiceType,
      row.projectName,
      row.invoiceDate,
      String(row.totalAmount),
    ].some(value => value.toLowerCase().includes(keyword)),
  )
})

const relationshipLabels: Record<string, string> = {
  collecting: '资料收集',
  contracted: '已签合同',
  claiming: '请款中',
  paid: '已付款',
  settled: '已结算',
}

function date(value: string): string {
  return value.slice(0, 10) || '—'
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3">
    <template v-if="tab === 'projects'">
      <div class="panel bg-surface-2 px-3 py-2 text-11px text-ink-soft">
        按 ProjectSupplier 关系聚合 {{ snapshot.projects.length }} 个合作项目；合同额来自合同台账，实际付款来自付款申请。
      </div>
      <KitTable :columns="projectColumns" :data="projectRows" empty="暂无合作项目">
        <template #project="{ row }">
          <NuxtLink :to="`/project/${row.projectId}/supplier/${supplierId}`" class="cell--link">
            {{ row.projectName || row.projectId }}
          </NuxtLink>
        </template>
        <template #relationshipStatus="{ row }">
          <span class="chip chip-brand">{{ relationshipLabels[row.relationshipStatus] || row.relationshipStatus }}</span>
        </template>
        <template #balance="{ row }">
          <span class="font-mono" :class="row.payableBalance > 0 ? 'text-danger' : 'text-ok'">{{ yuan(row.payableBalance) }}</span>
        </template>
        <template #settlementStatus="{ row }">
          <span :class="row.settlementStatus === '已结清' ? 'chip chip-ok' : 'chip chip-warn'">{{ row.settlementStatus }}</span>
        </template>
      </KitTable>
    </template>

    <template v-else-if="tab === 'contracts'">
      <div class="flex flex-wrap items-center gap-2">
        <p class="mr-auto text-11px text-ink-soft">
          跨项目支出合同 · 点击合同或项目可追溯源单据
        </p>
        <select v-model="contractKind" class="field-input h-8 text-11px" aria-label="筛选合同类型">
          <option value="all">
            全部类型
          </option>
          <option v-for="kind in contractKinds" :key="kind" :value="kind">
            {{ kind }}
          </option>
        </select>
        <select v-model="contractOrder" class="field-input h-8 text-11px" aria-label="合同金额排序">
          <option value="desc">
            金额从高到低
          </option>
          <option value="asc">
            金额从低到高
          </option>
        </select>
      </div>
      <KitTable :columns="contractColumns" :data="visibleContracts" empty="暂无支出合同">
        <template #contract="{ row }">
          <NuxtLink :to="`/contract/${row.id}`" class="cell--link">
            {{ row.name }}
          </NuxtLink>
        </template>
        <template #project="{ row }">
          <NuxtLink :to="`/project/${row.projectId}`" class="cell--link">
            {{ row.projectName || row.projectId }}
          </NuxtLink>
        </template>
        <template #status="{ row }">
          <span :class="row.status === '已结清' ? 'chip chip-ok' : 'chip chip-brand'">{{ row.status || '—' }}</span>
        </template>
      </KitTable>
    </template>

    <template v-else-if="tab === 'payments'">
      <div class="flex flex-wrap items-center gap-2">
        <p class="mr-auto text-11px text-ink-soft">
          来源：付款申请表实时汇总；点击申请编号可追溯源单。
        </p>
        <select v-model="paymentOrder" class="field-input h-8 text-11px" aria-label="请款付款排序">
          <option value="date">
            按时间排序
          </option>
          <option value="amount">
            按审批金额排序
          </option>
        </select>
      </div>
      <KitTable :columns="paymentColumns" :data="visiblePayments" empty="暂无请款/付款记录">
        <template #payment="{ row }">
          <NuxtLink :to="`/finance/payment/${row.id}/detail`" class="cell--link font-mono">
            {{ row.applicationNo || row.id }}
          </NuxtLink>
        </template>
        <template #project="{ row }">
          <NuxtLink :to="`/project/${row.projectId}`" class="cell--link">
            {{ row.projectName || row.projectId }}
          </NuxtLink>
        </template>
        <template #date="{ row }">
          <span class="font-mono text-ink-soft">{{ date(row.createdAt) }}</span>
        </template>
        <template #status="{ row }">
          <span :class="row.paymentStatus === '已付款' ? 'chip chip-ok' : 'chip chip-brand'">{{ row.paymentStatus || row.approvalStatus || '—' }}</span>
        </template>
      </KitTable>
    </template>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <p class="mr-auto text-11px text-ink-soft">
          来源：已归档发票单表，严格按 supplierId 汇总，不做名称猜测。
        </p>
        <input v-model="invoiceSearch" type="search" class="field-input h-8 w-64 text-11px" placeholder="搜索发票号、类型、项目、金额或日期…">
      </div>
      <KitTable :columns="invoiceColumns" :data="visibleInvoices" empty="暂无已归档收票记录">
        <template #invoice="{ row }">
          <NuxtLink :to="`/finance/invoice/${row.id}`" class="cell--link font-mono">
            {{ row.invoiceNumber || row.id }}
          </NuxtLink>
        </template>
        <template #project="{ row }">
          <NuxtLink v-if="row.projectId" :to="`/project/${row.projectId}`" class="cell--link">
            {{ row.projectName || row.projectId }}
          </NuxtLink><span v-else>个人开支</span>
        </template>
      </KitTable>
    </template>
  </section>
</template>
