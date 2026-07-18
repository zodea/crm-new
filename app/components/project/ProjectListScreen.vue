<script setup lang="ts">
import type { ConfiguredExportSource, ExportData } from '~/lib/kit/export'
import type { KitTableColumn } from '~/lib/kit/table'
import type { StatusTone } from '~/lib/project/status'
import type { Project } from '~/stores/project'
import * as XLSX from 'xlsx'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'
import { projectLedgerRows } from '~/lib/project/export'
import { summarizeProjectFinance } from '~/lib/project/finance'
import { filterProjectColumns, filterProjects } from '~/lib/project/list'
import { PROJECT_STATUS_TONE, PROJECT_STATUSES } from '~/lib/project/status'
import { toErrorMessage } from '~/lib/util/error'

const store = useProjectStore()
const detailStore = useProjectDetailStore()
const { confirm, undoToast, success, error, exportFile, openImportTab } = useKitUI()

const searchText = shallowRef('')
const statusFilter = shallowRef('all')
const page = shallowRef(1)
const pageSize = shallowRef(10)
const showForm = shallowRef(false)
const editingRow = shallowRef<Project | null>(null)
const columnFilters = shallowRef<{ field: string, values: unknown[] }[]>([])

const statusOptions = [
  { key: 'all', label: '全部状态' },
  ...PROJECT_STATUSES.map(status => ({ key: status, label: status })),
]

// 列表页状态一律纯文字色，chip 只进详情页/表单（DESIGN-TASTE §2.3/§4.5，#110 阶段⑤）
const toneText: Record<StatusTone, string> = {
  warn: 'cell--status-warn',
  brand: 'font-600 text-brand-deep',
  muted: 'font-600 text-ink-soft',
  ok: 'cell--status-ok',
}

const filtered = computed(() => filterProjectColumns(
  filterProjects(store.list, {
    search: searchText.value,
    status: statusFilter.value,
  }),
  columnFilters.value,
))

const currentPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, currentPage.value, pageSize.value))

// 金额列（累计收入/预算总额）不是 Project 存储字段（口径见 lib/project/finance，#65 聚合），
// 表格数据行按页切片后就地补上，Project 类型保持纯净。
const tableRows = computed(() => pageRows.value.map((project) => {
  const summary = detailStore.operationSummaries[project.id]
  return {
    ...project,
    ...summarizeProjectFinance(project, summary
      ? {
          income: summary.projectReceipt,
          mainContractAmount: summary.mainContractAmount,
        }
      : undefined),
  }
}))

// 设计稿 ProjectScreen.jsx 红圈 13 列（顺序即列序）；金额列走 money 两位小数（元）。
const columns = computed<KitTableColumn[]>(() => [
  { field: 'name', title: '项目名称', minWidth: 170, fixed: 'left', slot: 'name' },
  { field: 'status', title: '业务流程阶段', width: 118, filterable: deriveFilterOptions(store.list, 'status'), slot: 'status' },
  { field: 'income', title: '累计收入', type: 'money', width: 130 },
  { field: 'budget', title: '预算总额', type: 'money', width: 130 },
  { field: 'startDate', title: '计划开工', type: 'date', width: 104 },
  { field: 'plannedEnd', title: '计划竣工日期', type: 'date', width: 118, filterable: deriveFilterOptions(store.list, 'plannedEnd') },
  { field: 'manager', title: '项目经理', width: 92, filterable: deriveFilterOptions(store.list, 'manager') },
  { field: 'actualEnd', title: '实际竣工日期', type: 'date', width: 118 },
  { field: 'execManager', title: '执行经理', width: 92 },
  { field: 'contractName', title: '项目合同名称', minWidth: 200 },
  { field: 'developer', title: '客户', minWidth: 150, filterable: deriveFilterOptions(store.list, 'developer'), slot: 'developer' },
  { field: 'builder', title: '施工员', width: 88 },
  { title: '操作', type: 'action', width: 116 },
])

watch([searchText, statusFilter], () => {
  page.value = 1
})

function statusClass(status: string): string {
  const tone = PROJECT_STATUS_TONE[status]
  return tone ? toneText[tone] : 'font-600 text-ink-soft'
}

function openCreate() {
  editingRow.value = null
  showForm.value = true
}

function openEdit(project: Project) {
  editingRow.value = project
  showForm.value = true
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
  searchText.value = ''
  statusFilter.value = 'all'
  columnFilters.value = []
  await store.load()
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

onMounted(() => Promise.all([store.load(), detailStore.load()]))
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <ProjectListToolbar
      v-model:search="searchText"
      v-model:status="statusFilter"
      :total="store.list.length"
      :visible="filtered.length"
      :loading="store.loading"
      :status-options="statusOptions"
      @refresh="refresh"
      @create="openCreate"
      @import="openImport"
      @export-ledger="exportLedger"
      @export-by-category="exportByCategory"
    />

    <KitTable
      :columns="columns"
      :data="tableRows"
      :loading="store.loading"
      :page="{ page: currentPage, pageSize, total: filtered.length }"
      remote-filter
      empty="没有符合筛选条件的项目"
      @page-change="handlePageChange"
      @filter-change="handleColumnFilter"
    >
      <template #name="{ row }">
        <EntityLink :id="row.id" type="project" :label="row.name" />
      </template>

      <template #status="{ row }">
        <span :class="statusClass(row.status)">{{ row.status }}</span>
      </template>

      <template #developer="{ row }">
        <!-- 客户详情未实装 → EntityLink 自动退化纯文本，实装后回填映射即全站上线（specs §07） -->
        <EntityLink type="customer" :label="row.developer" />
      </template>

      <template #action="{ row }">
        <div class="flex items-center justify-end gap-1">
          <NuxtLink :to="`/project/${row.id}`" class="icon-btn" title="详情" aria-label="查看项目详情">
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

    <ProjectFormDialog v-model:open="showForm" :project="editingRow" />
  </div>
</template>
