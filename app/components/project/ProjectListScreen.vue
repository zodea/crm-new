<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { StatusTone } from '~/lib/project/status'
import type { Project } from '~/stores/project'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'
import { filterProjectColumns, filterProjects } from '~/lib/project/list'
import { PROJECT_STATUS_TONE, PROJECT_STATUSES } from '~/lib/project/status'

const store = useProjectStore()
const { confirm, undoToast, success, error } = useKitUI()

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

const toneChip: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  muted: 'chip bg-surface-3 text-ink-soft',
  ok: 'chip-ok',
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

const columns = computed<KitTableColumn[]>(() => [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'name', title: '项目名称', minWidth: 170, fixed: 'left', slot: 'name' },
  { field: 'status', title: '项目状态', width: 106, filterable: deriveFilterOptions(store.list, 'status'), slot: 'status' },
  { field: 'contractAmount', title: '合同金额（万元）', type: 'money', width: 150 },
  { field: 'operationType', title: '经营类型', width: 92, filterable: deriveFilterOptions(store.list, 'operationType') },
  { field: 'startDate', title: '计划开工', type: 'date' },
  { field: 'plannedEnd', title: '计划竣工日期', type: 'date', width: 118 },
  { field: 'manager', title: '项目经理', width: 92, filterable: deriveFilterOptions(store.list, 'manager') },
  { field: 'actualEnd', title: '实际竣工日期', type: 'date', width: 118 },
  { field: 'siteLeader', title: '现场负责人', width: 100 },
  { field: 'contractName', title: '项目合同名称', minWidth: 190 },
  { field: 'developer', title: '客户', minWidth: 150, filterable: deriveFilterOptions(store.list, 'developer'), slot: 'developer' },
  { field: 'contractor', title: '总包单位', minWidth: 170 },
  { field: 'region', title: '工程地域', width: 100, filterable: deriveFilterOptions(store.list, 'region') },
  { title: '操作', type: 'action', width: 130 },
])

watch([searchText, statusFilter], () => {
  page.value = 1
})

function statusClass(status: string): string {
  const tone = PROJECT_STATUS_TONE[status]
  return tone ? toneChip[tone] : 'chip bg-surface-3 text-ink-soft'
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

onMounted(() => store.load())
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
    />

    <KitTable
      class="overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-card)]"
      :columns="columns"
      :data="pageRows"
      :loading="store.loading"
      :page="{ page: currentPage, pageSize, total: filtered.length }"
      remote-filter
      empty="没有符合筛选条件的项目"
      @page-change="handlePageChange"
      @filter-change="handleColumnFilter"
    >
      <template #name="{ row }">
        <NuxtLink :to="`/project/${row.id}`" class="cell--link">
          {{ row.name }}
        </NuxtLink>
      </template>

      <template #status="{ row }">
        <span :class="statusClass(row.status)">{{ row.status }}</span>
      </template>

      <template #developer="{ row }">
        <span class="font-600 text-brand-deep">{{ row.developer || '—' }}</span>
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
