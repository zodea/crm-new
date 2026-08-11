<script setup lang="ts">
import type {
  PaymentManagementRow,
  PaymentManagementSummary,
} from '~/stores/payment-management'
import { financeDetailPath } from '~/lib/finance/page'
import { clampPage, paginate } from '~/lib/kit/table'

type PaymentView = 'due' | 'paid' | 'all'

const store = usePaymentManagementStore()
const { rows, loading, projectOptions } = storeToRefs(store)

const search = shallowRef('')
const project = shallowRef('all')
const view = shallowRef<PaymentView>('due')
const page = shallowRef(1)
const pageSize = shallowRef(10)

const scopedRows = computed(() => {
  const keyword = search.value.trim().toLocaleLowerCase('zh-CN')
  return rows.value.filter((row) => {
    if (project.value !== 'all' && row.projectId !== project.value)
      return false
    if (!keyword)
      return true
    return [
      row.no,
      row.name,
      row.projectName,
      row.supplierName,
      row.bizType,
    ].some(value => value.toLocaleLowerCase('zh-CN').includes(keyword))
  })
})

const viewTabs = computed(() => [
  {
    key: 'due',
    label: '待支付',
    count: scopedRows.value.filter(row => row.dueAmount > 0).length,
  },
  {
    key: 'paid',
    label: '已付清',
    count: scopedRows.value.filter(row => row.paymentStatus === '已付清').length,
  },
  { key: 'all', label: '全部', count: scopedRows.value.length },
])

const filteredRows = computed(() => {
  if (view.value === 'due')
    return scopedRows.value.filter(row => row.dueAmount > 0)
  if (view.value === 'paid')
    return scopedRows.value.filter(row => row.paymentStatus === '已付清')
  return scopedRows.value
})

const summary = computed<PaymentManagementSummary>(() =>
  filteredRows.value.reduce<PaymentManagementSummary>((result, row) => ({
    applicationCount: result.applicationCount + 1,
    approvedAmount: result.approvedAmount + row.approvedAmount,
    paidAmount: result.paidAmount + row.paidAmount,
    dueAmount: result.dueAmount + row.dueAmount,
    dueCount: result.dueCount + Number(row.dueAmount > 0),
  }), {
    applicationCount: 0,
    approvedAmount: 0,
    paidAmount: 0,
    dueAmount: 0,
    dueCount: 0,
  }),
)

const currentPage = computed(() =>
  clampPage(page.value, filteredRows.value.length, pageSize.value),
)
const pageRows = computed(() =>
  paginate(filteredRows.value, currentPage.value, pageSize.value),
)

watch([search, project, view], () => {
  page.value = 1
})

function onPageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

function setSearch(value: string) {
  search.value = value
}

function setProject(value: string) {
  project.value = value
}

function openApplication(row: PaymentManagementRow) {
  void navigateTo(financeDetailPath('payment_application', row.id))
}

function createPayment(row: PaymentManagementRow) {
  const query: Record<string, string> = {
    paymentApplicationId: row.id,
    amount: String(row.dueAmount),
  }
  if (row.projectId)
    query.projectId = row.projectId
  if (row.supplierId)
    query.supplierId = row.supplierId
  void navigateTo({ path: '/finance/records/new', query })
}

function refresh() {
  void store.load()
}

function openRecords() {
  void navigateTo('/finance/records')
}

onMounted(() => {
  void store.load()
})
onActivated(() => {
  void store.load()
})
</script>

<template>
  <main class="flex min-w-0 max-w-full flex-col gap-4">
    <PaymentManagementToolbar
      :search="search"
      :project="project"
      :loading="loading"
      :project-options="projectOptions"
      @update:search="setSearch"
      @update:project="setProject"
      @refresh="refresh"
      @open-records="openRecords"
    />

    <PaymentManagementSummary :summary="summary" />

    <section aria-label="付款状态视图" class="panel px-3">
      <SegTab v-model="view" :tabs="viewTabs" />
    </section>

    <PaymentManagementTable
      :rows="pageRows"
      :loading="loading"
      :page="currentPage"
      :page-size="pageSize"
      :total="filteredRows.length"
      @page-change="onPageChange"
      @open-application="openApplication"
      @create-payment="createPayment"
    />
  </main>
</template>
