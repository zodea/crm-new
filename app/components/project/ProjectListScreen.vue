<script setup lang="ts">
import type { ConfiguredExportSource, ExportData } from '~/lib/kit/export'
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import type { ProjectListPageDTO, ProjectListQueryDTO } from '~/lib/project/repository'
import type { StatusTone } from '~/lib/project/status'
import type { DataOriginDTO } from '~/types/read-model'
import { useDebounceFn } from '@vueuse/core'
import * as XLSX from 'xlsx'
import { resolveEntityLink } from '~/lib/kit/entity-link'
import { projectLedgerRows } from '~/lib/project/export'
import { projectListViewRow } from '~/lib/project/list'
import { IMPORTED_PROJECT_STATUS } from '~/lib/project/repository'
import { PROJECT_STATUS_TONE, PROJECT_STATUSES } from '~/lib/project/status'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const readStore = useProjectListStore()
const dataVisibilityStore = useDataVisibilityStore()
const includeDemo = computed(() => dataVisibilityStore.includeDemo)
const { error, exportFile } = useKitUI()

const searchText = shallowRef('')
const selectedPhase = shallowRef('all')
const sortMode = shallowRef<'updated-desc' | 'name-asc'>('updated-desc')
const filtersVisible = shallowRef(true)
const density = shallowRef<'compact' | 'comfortable'>('compact')
const page = shallowRef(1)
const pageSize = shallowRef(10)
const columnFilters = shallowRef<{ field: string, values: unknown[] }[]>([])
const tableRef = useTemplateRef<{ clearFilter: () => Promise<void> }>('tableRef')

const IMPORTED_PHASES_KEY = 'imported-phases'
const WRITE_DISABLED_REASON = '项目写入尚未接入中央后台'
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

function projectDetailPath(row: { id: string, name: string, dataOrigin: DataOriginDTO }): string {
  const resolution = resolveEntityLink({
    type: 'project',
    id: row.id,
    label: row.name,
    dataOrigin: row.dataOrigin,
  })
  return resolution.kind === 'link' ? resolution.to : '/project'
}

const readPage = computed<ProjectListPageDTO | null>(() => {
  const state = readStore.state
  if (state.kind === 'ready' || state.kind === 'partial' || state.kind === 'empty')
    return state.data
  if (state.kind === 'loading' || state.kind === 'error')
    return state.previous
  return null
})

const sourceRows = computed(() => readPage.value?.items.map(projectListViewRow) ?? [])
const tableRows = computed(() => sourceRows.value)
const statusCounts = computed(() => Object.fromEntries(
  (readPage.value?.summary.facets.statuses ?? []).map(facet => [facet.value, facet.count]),
))
const availableTotal = computed(() => Object.values(statusCounts.value)
  .reduce((total, count) => total + count, 0))
const visibleTotal = computed(() => readPage.value?.pagination.total ?? 0)
const summary = computed(() => readPage.value?.summary ?? null)
const realSummary = computed(() => summary.value?.origins.real ?? null)
const demoSummary = computed(() => summary.value?.origins.demo ?? null)
const listSummary = computed<Record<string, string | number>>(() => {
  const result: Record<string, string | number> = {
    正式项目: realSummary.value?.projectCount ?? 0,
    正式收入: yuan(realSummary.value?.income.value),
    正式预算: yuan(realSummary.value?.budget.value),
  }
  if (includeDemo.value) {
    result.测试项目 = demoSummary.value?.projectCount ?? 0
    result.测试收入 = yuan(demoSummary.value?.income.value)
    result.测试预算 = yuan(demoSummary.value?.budget.value)
  }
  return result
})
const loading = computed(() => readStore.state.kind === 'loading')
const problem = computed(() => {
  const state = readStore.state
  return state.kind === 'forbidden'
    || state.kind === 'not-found'
    || state.kind === 'mismatch'
    || state.kind === 'error'
    ? state.problem
    : null
})

const importedPhases = computed(() =>
  Object.keys(statusCounts.value)
    .filter(status => status && !PROJECT_STATUSES.includes(status as typeof PROJECT_STATUSES[number]))
    .sort((a, b) => a.localeCompare(b, 'zh-CN')),
)

const phaseTree = computed<TreeNode[]>(() => {
  const count = (phase: string) => statusCounts.value[phase] ?? 0
  const visibleCount = (value: number) => includeDemo.value ? undefined : value
  const items: TreeNode[] = [
    {
      key: 'all',
      label: '全部项目',
      icon: 'i-lucide-folder',
      count: visibleCount(availableTotal.value),
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
      count: visibleCount(count(status)),
    })),
  ]
  if (importedPhases.value.length) {
    items.push({
      key: IMPORTED_PHASES_KEY,
      label: '待归一阶段',
      icon: 'i-lucide-archive',
      count: visibleCount(importedPhases.value.reduce((total, status) => total + count(status), 0)),
      children: importedPhases.value.map(status => ({
        key: status,
        label: status,
        count: visibleCount(count(status)),
      })),
    })
  }
  return items
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
        description: includeDemo.value
          ? '当前正式与测试来源都没有项目记录。'
          : '正式工作区暂无项目。测试数据默认隐藏，可在顶部显式开启“包含测试数据”。',
        actionLabel: '了解新增状态',
      }
})

// 运行参考列序；本地没有采购/仓管/预算/生产经理字段，因此不生成虚假空列。
const columns = computed<KitTableColumn[]>(() => [
  { field: 'name', title: '项目名称', minWidth: 170, fixed: 'left', slot: 'name' },
  { field: 'dataOrigin', title: '数据来源', width: 88, slot: 'origin' },
  { field: 'status', title: '业务阶段', width: 128, filterable: controlledFacets('status', summary.value?.facets.statuses), slot: 'status' },
  { field: 'income', title: '累计收入合同金额', type: 'money', width: 150 },
  { field: 'budget', title: '预算总额', type: 'money', width: 130 },
  { field: 'plannedEnd', title: '计划竣工', type: 'date', width: 112, filterable: controlledFacets('plannedEnd', summary.value?.facets.plannedEnds) },
  { field: 'actualEnd', title: '实际竣工', type: 'date', width: 112 },
  { field: 'manager', title: '项目经理', width: 92, filterable: controlledFacets('manager', summary.value?.facets.managers) },
  { field: 'execManager', title: '执行经理', width: 92 },
  { field: 'contractName', title: '项目合同名称', minWidth: 200 },
  { field: 'developer', title: '客户', minWidth: 150, filterable: controlledFacets('developer', summary.value?.facets.customers), slot: 'developer' },
  { field: 'builder', title: '施工员', width: 88 },
  { title: '操作', type: 'action', width: 116 },
])

function controlledFacets(
  field: string,
  facets: readonly { label: string, value: string }[] | undefined,
) {
  const selected = new Set(columnFilterValues(field))
  return (facets ?? []).map(facet => ({
    ...facet,
    checked: selected.has(facet.value),
  }))
}

function statusClass(status: string): string {
  const tone = PROJECT_STATUS_TONE[status]
  return tone ? toneText[tone] : 'font-600 text-ink-soft'
}

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

function handleColumnFilter(payload: { filters: { field: string, values: unknown[] }[] }) {
  columnFilters.value = payload.filters
  resetPageAndLoad()
}

async function refresh() {
  await loadProjects()
}

async function clearFilters() {
  const hadColumnFilters = columnFilters.value.some(filter => filter.values.length > 0)
  const unchanged = !searchText.value
    && selectedPhase.value === 'all'
    && !hadColumnFilters
    && page.value === 1
  searchText.value = ''
  selectedPhase.value = 'all'
  columnFilters.value = []
  page.value = 1
  await tableRef.value?.clearFilter()
  if (unchanged || hadColumnFilters)
    await loadProjects()
}

async function handleEmptyAction() {
  if (hasActiveFilters.value)
    await clearFilters()
  else
    error(WRITE_DISABLED_REASON)
}

function columnFilterValues(field: string): string[] {
  return (columnFilters.value.find(filter => filter.field === field)?.values ?? [])
    .filter((value): value is string => typeof value === 'string')
}

function currentQuery(): ProjectListQueryDTO {
  return {
    includeDemo: includeDemo.value,
    search: searchText.value,
    status: selectedPhase.value === 'all'
      ? null
      : selectedPhase.value === IMPORTED_PHASES_KEY
        ? IMPORTED_PROJECT_STATUS
        : selectedPhase.value,
    filters: {
      statuses: columnFilterValues('status'),
      plannedEnds: columnFilterValues('plannedEnd'),
      managers: columnFilterValues('manager'),
      customerIds: columnFilterValues('developer'),
    },
    sort: sortMode.value,
    page: page.value,
    pageSize: pageSize.value as ProjectListQueryDTO['pageSize'],
  }
}

async function loadProjects() {
  const query = currentQuery()
  await readStore.load(query)
}

function resetPageAndLoad() {
  if (page.value === 1)
    void loadProjects()
  else
    page.value = 1
}

const loadSearch = useDebounceFn(resetPageAndLoad, 180)

watch(searchText, () => {
  void loadSearch()
})

watch([selectedPhase, sortMode, includeDemo], resetPageAndLoad)

watch([page, pageSize], () => {
  void loadProjects()
})

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
  try {
    const rows = (await readStore.listAll(currentQuery())).map(projectListViewRow)
    if (!rows.length) {
      error('当前没有可导出的项目')
      return
    }
    await exportFile({
      data: rowsToXlsx(projectLedgerRows(rows), '项目台账'),
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
  try {
    const rows = (await readStore.listAll(currentQuery())).map(projectListViewRow)
    if (!rows.length) {
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
      files: rows.map(project => ({
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

onMounted(() => {
  void loadProjects()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <StatePanel
      v-if="readStore.state.kind === 'loading' && !readPage"
      kind="loading"
      title="正在加载项目列表"
      compact
    />

    <StatePanel
      v-else-if="readStore.state.kind === 'forbidden'"
      kind="forbidden"
      title="无项目查看权限"
      :description="problem?.message"
      compact
    />

    <StatePanel
      v-else-if="readStore.state.kind === 'not-found'"
      kind="empty"
      title="项目列表来源不存在"
      :description="problem?.message"
      compact
    />

    <StatePanel
      v-else-if="readStore.state.kind === 'mismatch'"
      kind="error"
      title="项目列表关系不匹配"
      :description="problem?.message"
      compact
    />

    <StatePanel
      v-else-if="readStore.state.kind === 'error'"
      kind="error"
      title="项目列表加载失败"
      :description="problem?.message"
      action-label="重新加载"
      compact
      @action="readStore.retry"
    />

    <ListShell
      v-if="readPage"
      v-model:tree-key="selectedPhase"
      v-model:view-key="sortMode"
      :tree="filtersVisible ? phaseTree : []"
      :views="listViews"
      :summary="listSummary"
    >
      <template #toolbar>
        <ProjectListToolbar
          v-model:search="searchText"
          v-model:sort-mode="sortMode"
          v-model:filters-visible="filtersVisible"
          v-model:density="density"
          :real-total="realSummary?.projectCount ?? 0"
          :demo-total="demoSummary?.projectCount ?? 0"
          :include-demo="includeDemo"
          :visible="visibleTotal"
          :loading="loading"
          :write-disabled-reason="WRITE_DISABLED_REASON"
          @refresh="refresh"
          @export-ledger="exportLedger"
          @export-by-category="exportByCategory"
        />
      </template>

      <template #table>
        <KitTable
          ref="tableRef"
          :columns="columns"
          :data="tableRows"
          :loading="loading"
          :row-height="tableRowHeight"
          row-key="rowIdentity"
          :page="{ page: readPage.pagination.page, pageSize: readPage.pagination.pageSize, total: readPage.pagination.total }"
          remote-filter
          :empty="emptyState"
          @page-change="handlePageChange"
          @filter-change="handleColumnFilter"
          @empty-action="handleEmptyAction"
        >
          <template #name="{ row }">
            <EntityLink :id="row.id" type="project" :label="row.name" :data-origin="row.dataOrigin" />
          </template>

          <template #origin="{ row }">
            <span
              v-if="row.dataOrigin === 'demo'"
              class="chip chip-warn"
            >测试数据</span>
            <span v-else class="text-11px font-600 text-ink-soft">正式数据</span>
          </template>

          <template #status="{ row }">
            <span :class="statusClass(row.status)">{{ row.status }}</span>
          </template>

          <template #developer="{ row }">
            <EntityLink
              v-if="row.customer.state === 'resolved'"
              :id="row.customer.id"
              type="customer"
              :label="row.customer.label"
              :data-origin="row.dataOrigin"
            />
            <span v-else-if="row.customer.state === 'forbidden'" class="text-ink-soft">无权限</span>
            <span v-else class="text-ink-faint">—</span>
          </template>

          <template #action="{ row }">
            <div class="flex items-center justify-end gap-1">
              <NuxtLink
                :to="projectDetailPath(row)"
                class="icon-btn"
                title="详情"
                :aria-label="`查看${row.name}项目详情`"
              >
                <span class="i-lucide-file-text text-14px" aria-hidden="true" />
              </NuxtLink>
              <button
                class="icon-btn disabled:cursor-not-allowed disabled:opacity-45"
                :title="row.dataOrigin === 'demo' ? '测试数据只能在演示工作区修改' : WRITE_DISABLED_REASON"
                aria-label="编辑项目"
                disabled
              >
                <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
              </button>
              <button
                class="icon-btn-danger disabled:cursor-not-allowed disabled:opacity-45"
                :title="row.dataOrigin === 'demo' ? '测试数据只能在演示工作区修改' : WRITE_DISABLED_REASON"
                aria-label="删除项目"
                disabled
              >
                <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
              </button>
            </div>
          </template>
        </KitTable>
      </template>

      <template #summary>
        <div
          class="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1"
          aria-label="项目列表汇总"
        >
          <span data-origin-summary="real" class="inline-flex flex-wrap items-center gap-x-2">
            <b class="text-ink">正式数据</b>
            <span><b class="font-mono text-ink">{{ realSummary?.projectCount ?? 0 }}</b> 个</span>
            <span>累计收入 <b class="font-mono text-ink">{{ yuan(realSummary?.income.value) }}</b></span>
            <small v-if="realSummary?.income.missingSources.length" class="text-ink-faint">收入缺失 {{ realSummary.income.missingSources.length }} 个</small>
            <span>预算总额 <b class="font-mono text-ink">{{ yuan(realSummary?.budget.value) }}</b></span>
            <small v-if="realSummary?.budget.missingSources.length" class="text-ink-faint">预算缺失 {{ realSummary.budget.missingSources.length }} 个</small>
          </span>
          <span
            v-if="includeDemo"
            data-origin-summary="demo"
            class="inline-flex flex-wrap items-center gap-x-2 border-l border-line pl-5"
          >
            <b class="text-warn">测试数据</b>
            <span><b class="font-mono text-warn">{{ demoSummary?.projectCount ?? 0 }}</b> 个</span>
            <span>累计收入 <b class="font-mono text-ink">{{ yuan(demoSummary?.income.value) }}</b></span>
            <small v-if="demoSummary?.income.missingSources.length" class="text-ink-faint">收入缺失 {{ demoSummary.income.missingSources.length }} 个</small>
            <span>预算总额 <b class="font-mono text-ink">{{ yuan(demoSummary?.budget.value) }}</b></span>
            <small v-if="demoSummary?.budget.missingSources.length" class="text-ink-faint">预算缺失 {{ demoSummary.budget.missingSources.length }} 个</small>
          </span>
        </div>
      </template>
    </ListShell>
  </div>
</template>
