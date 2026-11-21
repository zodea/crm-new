<script setup lang="ts">
import type {
  PaymentManagementRow,
  PaymentManagementSummary as PaymentManagementSummaryType,
} from '~/stores/payment-management'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { financeDetailPath } from '~/lib/finance/page'
import { clampPage, paginate } from '~/lib/kit/table'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { toErrorMessage } from '~/lib/util/error'
import PaymentManagementSummary from '~/pages/finance/payment-management/_components/PaymentManagementSummary.vue'
import PaymentManagementTable from '~/pages/finance/payment-management/_components/PaymentManagementTable.vue'
import PaymentManagementToolbar from '~/pages/finance/payment-management/_components/PaymentManagementToolbar.vue'
import PaymentPayrollSection from '~/pages/finance/payment-management/_components/PaymentPayrollSection.vue'
import { summarizePayments } from '~/stores/payment-management'

const store = usePaymentManagementStore()
const { rows, loading, hasSnapshot, currentRead, snapshotOrigin, projectOptions } = storeToRefs(store)
const loadError = shallowRef('')
let readGeneration = 0
bindReadAuthority((problem) => {
  ++readGeneration
  loadError.value = problem.message
})

const search = shallowRef('')
const project = shallowRef('all')
const view = shallowRef<string[]>(['due'])
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

const viewOptions = [
  { key: 'due', label: '待支付' },
  { key: 'paid', label: '已付清' },
]

const filteredRows = computed(() => scopedRows.value.filter(row =>
  !view.value.length
  || (view.value.includes('due') && (row.dueAmount ?? 0) > 0)
  || (view.value.includes('paid') && row.paymentStatus === '已付清'),
))

const summary = computed<PaymentManagementSummaryType>(() => summarizePayments(filteredRows.value))

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
  if (!currentRead.value || row.dueAmount === null || row.canRegisterPayment === false)
    return
  const query: Record<string, string> = {
    paymentApplicationId: row.id,
    amount: String(row.dueAmount),
  }
  if (row.projectId)
    query.projectId = row.projectId
  if (row.supplierId)
    query.supplierId = row.supplierId
  if (row.workerId)
    query.workerId = row.workerId
  void navigateTo({ path: '/finance/records/new', query })
}

async function refresh() {
  const token = ++readGeneration
  loadError.value = ''
  try {
    await store.load()
  }
  catch (cause) {
    if (token === readGeneration)
      loadError.value = toErrorMessage(cause)
  }
}

function openRecords() {
  void navigateTo('/finance/records')
}

onMounted(() => {
  void refresh()
})
onActivated(() => {
  void refresh()
})
</script>

<template>
  <main class="flex min-w-0 max-w-full flex-col gap-4" :aria-busy="loading">
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

    <PaymentManagementSummary v-if="hasSnapshot" :summary="summary" />
    <p v-else role="status" class="text-12px text-ink-soft" data-testid="payment-management-summary-unknown">
      付款管理金额尚未核实，请等待或重新读取。
    </p>
    <StatePanel v-if="loadError" kind="error" title="付款管理读取失败" :description="loadError" :compact="hasSnapshot" action-label="重试" @action="refresh" />
    <p v-if="hasSnapshot && !currentRead" role="status" class="text-12px text-ink-soft">
      以下为上次成功读取的数据，暂不能据此登记支付；请重新读取核实。
    </p>
    <p v-if="snapshotOrigin === 'demo'" role="status" class="text-12px text-ink-soft">
      当前为测试数据，只读查看；正式付款请切回实际来源。
    </p>

    <section aria-label="付款状态视图" class="panel px-3 py-2">
      <KitMultiSelectFilter v-model="view" label="付款状态" :options="viewOptions" />
    </section>

    <PaymentManagementTable
      :rows="pageRows"
      :loading="loading && !hasSnapshot"
      :page="currentPage"
      :page-size="pageSize"
      :total="filteredRows.length"
      :can-register="currentRead && snapshotOrigin !== 'demo'"
      @page-change="onPageChange"
      @open-application="openApplication"
      @create-payment="createPayment"
    />
    <PaymentPayrollSection />
  </main>
</template>
