<script setup lang="ts">
import type { ConfiguredExportSource, ExportData } from '~/lib/kit/export'
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import type { StatusTone } from '~/lib/project/status'
import type { Project } from '~/stores/project'
import * as XLSX from 'xlsx'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'
import { projectLedgerRows } from '~/lib/project/export'
import { summarizeProjectFinance } from '~/lib/project/finance'
import { filterProjectColumns } from '~/lib/project/list'
import { PROJECT_STATUS_TONE, PROJECT_STATUSES } from '~/lib/project/status'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const store = useProjectStore()
const detailStore = useProjectDetailStore()
const { confirm, undoToast, success, error, exportFile, openImportTab } = useKitUI()

const searchText = shallowRef('')
const selectedPhase = shallowRef('all')
const sortMode = shallowRef<'updated-desc' | 'name-asc'>('updated-desc')
const filtersVisible = shallowRef(true)
const density = shallowRef<'compact' | 'comfortable'>('compact')
const page = shallowRef(1)
const pageSize = shallowRef(10)
const columnFilters = shallowRef<{ field: string, values: unknown[] }[]>([])
const tableRef = useTemplateRef<{ clearFilter: () => Promise<void> }>('tableRef')

const SEARCH_FIELDS = [
  'name',
  'code',
  'address',
  'contractName',
  'developer',
  'manager',
  'execManager',
  'builder',
] as const satisfies readonly (keyof Project)[]
const IMPORTED_PHASES_KEY = 'imported-phases'
const listViews = [
  { key: 'updated-desc', label: '最近更新' },
  { key: 'name-asc', label: '项目名称' },
]

// 列表页状态一律纯文字色，chip 只进详情页/表单（DESIGN-TASTE §2.3/§4.5，#110 阶段⑤）
const toneText: Record<StatusTone, string> = {
  warn: 'cell--status-warn',
  brand: 'font-600 text-brand-deep',
  muted: 'font-600 text-ink-soft',
  ok: 'cell--status-ok',
}

const searched = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase('zh-CN')
  if (!query)
    return store.list
  return store.list.filter(project =>
    SEARCH_FIELDS.some(field =>
      String(project[field] ?? '').toLocaleLowerCase('zh-CN').includes(query),
    ),
  )
})

const importedPhases = computed(() =>
  [...new Set(searched.value.map(project => project.status))]
    .filter(status => status && !PROJECT_STATUSES.includes(status as typeof PROJECT_STATUSES[number]))
    .sort((a, b) => a.localeCompare(b, 'zh-CN')),
)

function phaseMatches(project: Project, phase: string): boolean {
  return phase === 'all'
    || project.status === phase
    || (phase === IMPORTED_PHASES_KEY && importedPhases.value.includes(project.status))
}

const phaseTree = computed<TreeNode[]>(() => {
  const count = (phase: string) => searched.value.filter(project => phaseMatches(project, phase)).length
  const items: TreeNode[] = [
    {
      key: 'all',
      label: '全部项目',
      icon: 'i-lucide-folder',
      count: searched.value.length,
    },
    ...PROJECT_STATUSES.map(status => ({
      key: status,
      label: status,
      icon: status === '施工中'
        ? 'i-lucide-hard-hat'
        : status === '筹备中'
          ? 'i-lucide-clipboard-check'
          : status === '停工'
            ? 'i-lucide-circle-pause'
            : 'i-lucide-circle-check-big',
      count: count(status),
    })),
  ]
  if (importedPhases.value.length) {
    items.push({
      key: IMPORTED_PHASES_KEY,
      label: '待归一阶段',
      icon: 'i-lucide-archive',
      count: importedPhases.value.reduce((total, status) => total + count(status), 0),
      children: importedPhases.value.map(status => ({
        key: status,
        label: status,
        count: count(status),
      })),
    })
  }
  return items
})

const phaseRows = computed(() =>
  searched.value.filter(project => phaseMatches(project, selectedPhase.value)),
)

const filtered = computed(() => {
  const rows = filterProjectColumns(phaseRows.value, columnFilters.value)
  return [...rows].sort((a, b) => {
    if (sortMode.value === 'name-asc')
      return a.name.localeCompare(b.name, 'zh-CN')
    return b.updatedAt.localeCompare(a.updatedAt)
  })
})

const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))

const baselineBudgetByProject = computed(() => new Map(
  detailStore.targetCosts
    .filter(row => row.status === '当前基线')
    .map(row => [row.projectId, row.targetAmount]),
))

// 金额列不是 Project 存储字段：收入来自正式收款聚合，预算来自当前目标成本基线。
// 任一事实尚未载入或不存在时保持 null，由表格显示「—」。
const tableRows = computed(() => pageRows.value.map((project) => {
  const operation = detailStore.operationSummaries[project.id]
  return {
    ...project,
    ...summarizeProjectFinance({
      income: operation?.projectReceipt ?? null,
      budget: baselineBudgetByProject.value.get(project.id) ?? null,
    }),
  }
}))

const summary = computed(() => {
  let income = 0
  let budget = 0
  let knownIncome = 0
  let knownBudget = 0
  for (const project of filtered.value) {
    const operation = detailStore.operationSummaries[project.id]
    const amounts = summarizeProjectFinance({
      income: operation?.projectReceipt ?? null,
      budget: baselineBudgetByProject.value.get(project.id) ?? null,
    })
    if (amounts.income != null) {
      income += amounts.income
      knownIncome += 1
    }
    if (amounts.budget != null) {
      budget += amounts.budget
      knownBudget += 1
    }
  }
  return {
    total: filtered.value.length,
    income: knownIncome === filtered.value.length && knownIncome > 0 ? income : null,
    budget: knownBudget === filtered.value.length && knownBudget > 0 ? budget : null,
    missingIncome: filtered.value.length - knownIncome,
    missingBudget: filtered.value.length - knownBudget,
  }
})

const tableRowHeight = computed(() => density.value === 'compact' ? 36 : 44)

const hasActiveFilters = computed(() => Boolean(
  searchText.value.trim()
  || selectedPhase.value !== 'all'
  || columnFilters.value.some(filter => filter.values.length > 0),
))

const emptyState = computed(() => {
  return hasActiveFilters.value
    ? {
        title: '没有符合条件的项目',
        description: '可清除搜索、状态和表头筛选后查看全部项目。',
        actionLabel: '清除筛选',
      }
    : {
        title: '还没有施工项目',
        description: '新建第一个项目后，可在这里跟踪阶段与经营数据。',
        actionLabel: '新增项目',
      }
})

// 运行参考列序；本地没有采购/仓管/预算/生产经理字段，因此不生成虚假空列。
const columns = computed<KitTableColumn[]>(() => [
  { field: 'name', title: '项目名称', minWidth: 170, fixed: 'left', slot: 'name' },
  { field: 'status', title: '业务阶段', width: 128, filterable: deriveFilterOptions(store.list, 'status'), slot: 'status' },
  { field: 'income', title: '累计收入合同金额', type: 'money', width: 150 },
  { field: 'budget', title: '预算总额', type: 'money', width: 130 },
  { field: 'plannedEnd', title: '计划竣工', type: 'date', width: 112, filterable: deriveFilterOptions(store.list, 'plannedEnd') },
  { field: 'actualEnd', title: '实际竣工', type: 'date', width: 112 },
  { field: 'manager', title: '项目经理', width: 92, filterable: deriveFilterOptions(store.list, 'manager') },
  { field: 'execManager', title: '执行经理', width: 92 },
  { field: 'contractName', title: '项目合同名称', minWidth: 200 },
  { field: 'developer', title: '客户', minWidth: 150, filterable: deriveFilterOptions(store.list, 'developer'), slot: 'developer' },
  { field: 'builder', title: '施工员', width: 88 },
  { title: '操作', type: 'action', width: 116 },
])

watch([searchText, selectedPhase, sortMode], () => {
  page.value = 1
})

function statusClass(status: string): string {
  const tone = PROJECT_STATUS_TONE[status]
  return tone ? toneText[tone] : 'font-600 text-ink-soft'
}

function openCreate() {
  void navigateTo('/project/form')
}

function openEdit(project: Project) {
  void navigateTo(`/project/form/${project.id}`)
}

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

function handleColumnFilter(payload: { filters: { field: string, values: unknown[] }[] }) {
  columnFilters.value = payload.filters
  page.value = 1
}

async function refresh() {
  await clearFilters()
  await loadProjects()
}

async function clearFilters() {
  searchText.value = ''
  selectedPhase.value = 'all'
  columnFilters.value = []
  page.value = 1
  await tableRef.value?.clearFilter()
}

async function handleEmptyAction() {
  if (hasActiveFilters.value)
    await clearFilters()
  else
    openCreate()
}

async function loadProjects() {
  try {
    await store.load()
  }
  catch {
    // Store exposes the user-facing error; the page renders the shared retry state.
  }
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 把导出行序列化为 xlsx 字节（单 sheet）。 */
function rowsToXlsx(rows: Record<string, unknown>[], sheetName: string): ExportData {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

// 导出路一：单文件台账 → ADR 0004「直接保存」（系统文件夹选择器，无需分类目录）。
async function exportLedger() {
  if (!filtered.value.length) {
    error('当前没有可导出的项目')
    return
  }
  try {
    await exportFile({
      data: rowsToXlsx(projectLedgerRows(filtered.value), '项目台账'),
      defaultName: `施工项目台账_${today()}.xlsx`,
      mimeType: XLSX_MIME,
    })
  }
  catch (err) {
    error(`导出失败：${toErrorMessage(err)}`)
  }
}

// 导出路二：按客户/阶段分两级目录、每个项目一个文件 → ADR 0004「配置导出」页签。
async function exportByCategory() {
  if (!filtered.value.length) {
    error('当前没有可导出的项目')
    return
  }
  const source: ConfiguredExportSource = {
    label: '项目台账',
    fields: [
      { key: 'developer', label: '客户' },
      { key: 'status', label: '业务流程阶段' },
      { key: 'name', label: '项目名称' },
      { key: 'region', label: '工程地域' },
    ],
    files: filtered.value.map(project => ({
      row: {
        developer: project.developer,
        status: project.status,
        name: project.name,
        region: project.region,
      },
      data: rowsToXlsx(projectLedgerRows([project]), '项目'),
      mimeType: XLSX_MIME,
    })),
  }
  try {
    await exportFile({
      requiresDirectoryStructure: true,
      source,
      structure: { levels: [{ field: 'developer', fallback: '未分类客户' }, { field: 'status', fallback: '未分阶段' }] },
      naming: { parts: [{ field: 'name', fallback: '未命名项目' }], extension: 'xlsx' },
    })
  }
  catch (err) {
    error(`分类导出失败：${toErrorMessage(err)}`)
  }
}

// 导入：打开项目映射页签（ADR 0005，实体触发/模板隐含）；上限阻断的 toast 由底座负责。
async function openImport() {
  try {
    await openImportTab({ entity: 'project' })
  }
  catch (err) {
    error(`导入打开失败：${toErrorMessage(err)}`)
  }
}

async function handleDelete(project: Project) {
  const impact = await store.downstreamImpact(project.id)
  const cascade = impact.length > 0
  const confirmed = await confirm(cascade
    ? {
        variant: 'cascade',
        title: '删除项目',
        message: `“${project.name}”挂有下游数据，删除后其下游数据一并隐藏。`,
        requireTyping: project.name,
        impact,
        confirmLabel: '删除',
      }
    : {
        variant: 'simple',
        title: '删除项目',
        message: `确认删除项目「${project.name}」？删除后可在 10 秒内撤回。`,
        confirmLabel: '删除',
      })

  if (!confirmed)
    return

  const logId = await store.remove(project.id)
  if (!logId) {
    error('删除失败：项目不存在或已删除')
    return
  }
  if (cascade)
    success(`已删除「${project.name}」及其下游数据`)
  else
    undoToast(`已删除「${project.name}」`, () => store.undo(logId))
}

onMounted(() => {
  void loadProjects()
  void detailStore.load().catch(() => {})
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <StatePanel
      v-if="store.error"
      kind="error"
      title="项目列表加载失败"
      :description="store.error"
      action-label="重新加载"
      compact
      @action="loadProjects"
    />

    <ListShell
      v-model:tree-key="selectedPhase"
      v-model:view-key="sortMode"
      :tree="filtersVisible ? phaseTree : []"
      :views="listViews"
      :summary="{
        项目数量: summary.total,
        累计收入: yuan(summary.income),
        预算总额: yuan(summary.budget),
      }"
    >
      <template #toolbar>
        <ProjectListToolbar
          v-model:search="searchText"
          v-model:sort-mode="sortMode"
          v-model:filters-visible="filtersVisible"
          v-model:density="density"
          :total="store.list.length"
          :visible="filtered.length"
          :loading="store.loading"
          @refresh="refresh"
          @create="openCreate"
          @import="openImport"
          @export-ledger="exportLedger"
          @export-by-category="exportByCategory"
        />
      </template>

      <template #table>
        <KitTable
          v-if="!store.error || store.list.length > 0"
          ref="tableRef"
          :columns="columns"
          :data="tableRows"
          :loading="store.loading || !store.loaded"
          :row-height="tableRowHeight"
          :page="{ page: currentPage, pageSize, total: filtered.length }"
          remote-filter
          :empty="emptyState"
          @page-change="handlePageChange"
          @filter-change="handleColumnFilter"
          @empty-action="handleEmptyAction"
        >
          <template #name="{ row }">
            <EntityLink :id="row.id" type="project" :label="row.name" />
          </template>

          <template #status="{ row }">
            <span :class="statusClass(row.status)">{{ row.status }}</span>
          </template>

          <template #developer="{ row }">
            <EntityLink :id="row.customerId" type="customer" :label="row.developer" />
          </template>

          <template #action="{ row }">
            <div class="flex items-center justify-end gap-1">
              <NuxtLink
                :to="`/project/${row.id}`"
                class="icon-btn"
                title="详情"
                :aria-label="`查看${row.name}项目详情`"
              >
                <span class="i-lucide-file-text text-14px" aria-hidden="true" />
              </NuxtLink>
              <button class="icon-btn" title="编辑" aria-label="编辑项目" @click="openEdit(row)">
                <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
              </button>
              <button class="icon-btn-danger" title="删除" aria-label="删除项目" @click="handleDelete(row)">
                <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
              </button>
            </div>
          </template>
        </KitTable>
      </template>

      <template #summary>
        <div
          v-if="!store.error || store.list.length > 0"
          class="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1"
          aria-label="项目列表汇总"
        >
          <span>显示 <b class="font-mono text-ink">{{ summary.total }}</b> 个项目</span>
          <span>
            累计收入 <b class="font-mono text-ink">{{ yuan(summary.income) }}</b>
            <small v-if="summary.missingIncome" class="ml-1 text-ink-faint">缺失 {{ summary.missingIncome }} 个</small>
          </span>
          <span>
            预算总额 <b class="font-mono text-ink">{{ yuan(summary.budget) }}</b>
            <small v-if="summary.missingBudget" class="ml-1 text-ink-faint">缺失 {{ summary.missingBudget }} 个</small>
          </span>
        </div>
      </template>
    </ListShell>
  </div>
</template>
