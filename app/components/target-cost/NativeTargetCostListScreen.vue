<script setup lang="ts">
import type { TargetCostListFilters, TargetCostListRow } from '~/lib/target-cost/list'
import { clampPage, paginate } from '~/lib/kit/table'
import { filterTargetCostList } from '~/lib/target-cost/list'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const listStore = useTargetCostListStore()
const targetCostStore = useTargetCostStore()
const { rows, loading, error: loadError } = storeToRefs(listStore)
const { confirm, success, warning } = useKitUI()

const search = shallowRef('')
const project = shallowRef('all')
const baseline = shallowRef<string[]>([])
const status = shallowRef<string[]>([])
const page = shallowRef(1)
const pageSize = shallowRef(10)

const projectOptions = computed(() => [
  { key: 'all', label: '全部项目' },
  ...(rows.value.some(row => !row.projectId)
    ? [{ key: 'unassigned', label: '未关联项目' }]
    : []),
  ...[...new Map(rows.value
    .flatMap(row => row.projectId
      ? [[
          row.projectId,
          { key: row.projectId, label: row.projectName || row.projectId },
        ] as const]
      : [])).values()],
])
const statusOptions = computed(() => [
  { key: 'all', label: '全部状态' },
  ...[...new Set(rows.value.map(row => row.status).filter(Boolean))]
    .map(value => ({
      key: value,
      label: value === 'submitted' ? '已提交' : value === 'draft' ? '草稿' : value,
    })),
])
const filters = computed<TargetCostListFilters>(() => ({
  search: search.value,
  project: project.value,
  baseline: baseline.value,
  status: status.value,
}))
const filteredRows = computed(() => filterTargetCostList(rows.value.filter(row => !row.deletedAt), filters.value))
const currentPage = computed(() => clampPage(page.value, filteredRows.value.length, pageSize.value))
const pageRows = computed(() => paginate(filteredRows.value, currentPage.value, pageSize.value))
const summary = computed(() => filteredRows.value.reduce(
  (total, row) => ({
    taxInclusiveTotal: total.taxInclusiveTotal + (row.taxInclusiveTotal ?? 0),
    signedContractSum: total.signedContractSum + (row.signedContractSum ?? 0),
    plannedProfit: total.plannedProfit + (row.plannedProfit ?? 0),
  }),
  { taxInclusiveTotal: 0, signedContractSum: 0, plannedProfit: 0 },
))
const hasFilters = computed(() =>
  Boolean(search.value.trim())
  || project.value !== 'all'
  || baseline.value.length > 0
  || status.value.length > 0,
)
function summaryValue(key: 'taxInclusiveTotal' | 'signedContractSum' | 'plannedProfit') {
  const missing = filteredRows.value.filter(row => row[key] == null).length
  if (missing && missing === filteredRows.value.length)
    return `未知 · 缺 ${missing} 个版本`
  return missing ? `已知 ${yuan(summary.value[key])} · 缺 ${missing} 个版本` : yuan(summary.value[key])
}

watch([search, project, baseline, status], () => {
  page.value = 1
})
watch(() => targetCostStore.revision, () => {
  void refresh()
})

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

async function refresh() {
  try {
    await listStore.load()
  }
  catch {
    /* 旧桌面 store 的加载错误由页面状态展示。 */ }
}

async function handleAction(action: string, row: TargetCostListRow) {
  if (action === 'detail') {
    await navigateTo(`/project/target-cost/${row.id}`)
    return
  }
  if (action === 'edit') {
    await navigateTo(`/project/target-cost/form/${row.id}`)
    return
  }
  if (action !== 'delete')
    return

  const accepted = await confirm({
    variant: 'simple',
    title: '删除目标成本',
    message: `确认删除「${row.name}」？记录将进入软删除状态。`,
    confirmLabel: '删除',
  })
  if (!accepted)
    return
  try {
    const logId = await targetCostStore.remove(row.id)
    if (!logId) {
      warning('目标成本版本不存在或已删除')
      return
    }
    success(`已删除「${row.name}」`)
    await listStore.load()
  }
  catch (cause) {
    warning(`无法删除「${row.name}」：${toErrorMessage(cause)}`)
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <TargetCostListFilters
      v-model:search="search"
      v-model:project="project"
      v-model:baseline="baseline"
      v-model:status="status"
      :loading="loading"
      :project-options="projectOptions"
      :status-options="statusOptions"
      @refresh="refresh"
      @create="navigateTo('/project/target-cost/form')"
    />

    <section
      v-if="loadError"
      role="alert"
      aria-label="目标成本列表加载失败"
      class="panel flex min-w-0 flex-wrap items-center gap-3 p-4"
    >
      <span class="i-lucide-circle-alert text-20px text-danger" aria-hidden="true" />
      <div class="min-w-52 flex-1">
        <h2 class="text-14px font-800 text-ink">
          目标成本列表加载失败
        </h2>
        <p class="mt-1 break-words text-12px text-ink-soft">
          {{ loadError }}
        </p>
      </div>
      <KitButton type="button" variant="secondary" @click="refresh">
        重新加载
      </KitButton>
    </section>

    <TargetCostListTable
      v-else
      :rows="pageRows"
      :loading="loading && !listStore.hasSnapshot"
      :aria-busy="loading"
      :page="currentPage"
      :page-size="pageSize"
      :total="filteredRows.length"
      :filtered="hasFilters"
      @page-change="handlePageChange"
      @action="handleAction"
    />

    <footer
      v-if="!loadError"
      role="status"
      class="panel flex min-w-0 flex-wrap items-center justify-end gap-x-6 gap-y-2 px-4 py-3 text-12px"
      aria-label="目标成本列表汇总"
    >
      <span class="mr-auto text-ink-faint">当前筛选 {{ filteredRows.length }} 个版本</span>
      <span class="text-ink-soft">含税合价 <b class="ml-1 font-mono text-ink">{{ summaryValue('taxInclusiveTotal') }}</b></span>
      <span class="text-ink-soft">已签合同 <b class="ml-1 font-mono text-ink">{{ summaryValue('signedContractSum') }}</b></span>
      <span class="text-ink-soft">计划利润 <b class="ml-1 font-mono text-ink">{{ summaryValue('plannedProfit') }}</b></span>
    </footer>
  </div>
</template>
