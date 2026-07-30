<script setup lang="ts">
import type {
  MasterDataListFilterField,
  MasterDataListSort,
  MasterDataRegistryKind,
} from '~/lib/master-data/list'
import type {
  MasterDataListRow,
} from '~/stores/master-data-read'
import { clampPage, paginate } from '~/lib/kit/table'
import {
  filterAndSortMasterDataRows,
  initialMasterDataFilterValues,
  MASTER_DATA_LIST_PROFILES,
  masterDataFilterOptions,
  masterDataStatusLabel,
} from '~/lib/master-data/list'
import { FORM_META } from '~/lib/master-data/page'
import { toErrorMessage } from '~/lib/util/error'
import {
  maskIdentifier,
  maskMiddle,
  maskPhone,
} from '~/lib/util/privacy'

const props = defineProps<{
  kind: MasterDataRegistryKind
}>()

const { confirm, undoToast, warning, error, success } = useKitUI()
const readStore = useMasterDataReadStore()
const { rowsByKind, loadingByKind } = storeToRefs(readStore)
const customerStore = useCustomerStore()
const crewStore = useCrewStore()
const workerStore = useWorkerStore()
const stores = {
  customer: customerStore,
  crew: crewStore,
  worker: workerStore,
}

const search = shallowRef('')
const sort = shallowRef<MasterDataListSort>('updated-desc')
const profile = computed(() => MASTER_DATA_LIST_PROFILES[props.kind])
const filterValues = shallowRef<Partial<Record<MasterDataListFilterField, string>>>(
  initialMasterDataFilterValues(profile.value),
)
const page = shallowRef(1)
const pageSize = shallowRef(10)
const loadError = shallowRef('')
let latestLoadRequest = 0

const rows = computed<MasterDataListRow[]>(() => [
  ...rowsByKind.value[props.kind],
])
const loading = computed(() => loadingByKind.value[props.kind])
const meta = computed(() => FORM_META[props.kind])
const activeStore = computed(() => stores[props.kind])
const activeRevision = computed(() => activeStore.value.revision)

const sortOptions = [
  { key: 'updated-desc', label: '最近更新' },
  { key: 'name-asc', label: '名称升序' },
  { key: 'name-desc', label: '名称降序' },
]
const filterOptions = computed(() => Object.fromEntries(
  profile.value.filters.map(definition => [
    definition.field,
    [
      { key: 'all', label: `全部${definition.label}` },
      ...masterDataFilterOptions(rows.value, definition.field),
    ],
  ]),
))
const visibleRows = computed(() => filterAndSortMasterDataRows(
  rows.value,
  profile.value,
  {
    search: search.value,
    sort: sort.value,
    values: filterValues.value,
  },
))
const currentPage = computed(() =>
  clampPage(page.value, visibleRows.value.length, pageSize.value),
)
const pageRows = computed(() =>
  paginate(visibleRows.value, currentPage.value, pageSize.value),
)
const hasFilters = computed(() =>
  Boolean(search.value.trim())
  || Object.values(filterValues.value).some(value => value !== 'all'),
)
const emptyState = computed(() => hasFilters.value
  ? {
      title: `没有符合条件的${meta.value.label}`,
      description: '可清除筛选后查看全部记录。',
      actionLabel: '清除筛选',
    }
  : {
      title: `暂无${meta.value.label}数据`,
      description: `新建第一条${meta.value.label}档案后将在此显示。`,
      actionLabel: `新建${meta.value.label}`,
    })
const listSummary = computed(() => ({
  当前记录: `${visibleRows.value.length} 条`,
  全部记录: `${rows.value.length} 条`,
}))

watch([search, filterValues, sort], () => {
  page.value = 1
})
watch(
  () => props.kind,
  () => {
    search.value = ''
    sort.value = 'updated-desc'
    filterValues.value = initialMasterDataFilterValues(profile.value)
    page.value = 1
  },
)

function statusClass(value: unknown): string {
  const status = String(value ?? '')
  if (['active', 'submitted', '在场', 'approved', '已提交', '有效'].includes(status))
    return 'chip chip-ok'
  if (['expired', 'inactive', '已退场', 'rejected', '停用'].includes(status))
    return 'chip bg-surface-3 text-ink-soft'
  return 'chip chip-warn'
}

function aliasesLabel(value: unknown): string {
  return Array.isArray(value) ? value.join('、') || '—' : String(value || '—')
}

function detailPath(row: MasterDataListRow): string {
  return meta.value.detailPath
    ? `${meta.value.detailPath}/${row.id}`
    : meta.value.listPath
}

async function load() {
  const request = ++latestLoadRequest
  loadError.value = ''
  try {
    await readStore.load(props.kind)
  }
  catch (cause) {
    if (request === latestLoadRequest)
      loadError.value = toErrorMessage(cause)
  }
}

function clearFilters() {
  search.value = ''
  filterValues.value = initialMasterDataFilterValues(profile.value)
  sort.value = 'updated-desc'
}

function handleEmptyAction() {
  if (hasFilters.value) {
    clearFilters()
    return
  }
  void navigateTo(meta.value.newPath)
}

function handlePageChange(payload: { page: number, pageSize: number }) {
  page.value = payload.page
  pageSize.value = payload.pageSize
}

async function remove(row: MasterDataListRow) {
  let assessment
  try {
    assessment = await activeStore.value.assessDeletion(row.id)
  }
  catch (cause) {
    warning(`无法检查「${row.name}」的关联数据：${toErrorMessage(cause)}`)
    return
  }
  if (assessment.blockedReason) {
    warning(`无法删除「${row.name}」：${assessment.blockedReason}`)
    return
  }

  const cascade = assessment.impact.length > 0
  const accepted = await confirm(cascade
    ? {
        variant: 'cascade',
        title: `删除${meta.value.label}`,
        message: `“${row.name}”挂有下游数据，删除后这些数据将一并隐藏。`,
        requireTyping: row.name,
        impact: assessment.impact,
        confirmLabel: '删除',
      }
    : {
        variant: 'simple',
        title: `删除${meta.value.label}`,
        message: `确认删除「${row.name}」？删除后可在 10 秒内撤回。`,
        confirmLabel: '删除',
      })
  if (!accepted)
    return
  try {
    const logId = await activeStore.value.remove(row.id)
    if (!logId) {
      error('记录不存在或已删除')
      return
    }
    if (cascade) {
      success(`已删除「${row.name}」及其下游数据`)
    }
    else {
      undoToast(`已删除「${row.name}」`, async () => {
        await activeStore.value.restore(row.id)
        await load()
      })
    }
    await load()
  }
  catch (cause) {
    warning(`无法删除「${row.name}」：${toErrorMessage(cause)}`)
  }
}

let mounted = false
watch(activeRevision, () => {
  if (mounted)
    void load()
})
onMounted(() => {
  mounted = true
  void load()
})
onActivated(() => {
  if (mounted)
    void load()
})
</script>

<template>
  <div class="min-w-0 grid gap-3">
    <StatePanel
      v-if="loadError"
      kind="error"
      :title="`${meta.label}列表加载失败`"
      :description="loadError"
      action-label="重新加载"
      :compact="rows.length > 0"
      @action="load"
    />

    <ListShell v-if="!loadError || rows.length" :summary="listSummary">
      <template #toolbar>
        <MasterDataListToolbar
          v-model:search="search"
          v-model:filters="filterValues"
          v-model:sort="sort"
          :entity-label="meta.label"
          :list-label="meta.listLabel"
          :loading="loading"
          :total="rows.length"
          :visible="visibleRows.length"
          :search-placeholder="profile.searchPlaceholder"
          :filter-definitions="profile.filters"
          :filter-options="filterOptions"
          :sort-options="sortOptions"
          @refresh="load"
          @create="navigateTo(meta.newPath)"
        />
      </template>

      <template #table>
        <div data-ui="master-data-list-table" class="min-w-0 max-w-full">
          <KitTable
            :columns="profile.columns"
            :data="pageRows"
            :loading="loading"
            :page="{ page: currentPage, pageSize, total: visibleRows.length }"
            :empty="emptyState"
            @empty-action="handleEmptyAction"
            @page-change="handlePageChange"
          >
            <template #name="{ row }">
              <NuxtLink
                :to="detailPath(row)"
                class="cell--link block max-w-full truncate"
                :title="row.name"
              >
                {{ row.name }}
              </NuxtLink>
            </template>

            <template #aliases="{ row }">
              <span class="block max-w-full truncate" :title="aliasesLabel(row.aliases)">
                {{ aliasesLabel(row.aliases) }}
              </span>
            </template>

            <template #identifier="{ row }">
              <span class="font-mono" :title="row.taxNo ? '已脱敏显示' : ''">
                {{ maskIdentifier(String(row.taxNo || '')) || '—' }}
              </span>
            </template>

            <template #workerIdentifier="{ row }">
              <span class="font-mono" :title="row.idCard ? '已脱敏显示' : ''">
                {{ maskMiddle(String(row.idCard || ''), 6, 4) || '—' }}
              </span>
            </template>

            <template #phone="{ row }">
              <span class="font-mono" :title="row.contactPhone || row.phone ? '已脱敏显示' : ''">
                {{ maskPhone(String(row.contactPhone || row.phone || '')) || '—' }}
              </span>
            </template>

            <template #status="{ row }">
              <span :class="statusClass(row.status)">
                {{ masterDataStatusLabel(row.status) }}
              </span>
            </template>

            <template #projectStatus="{ row }">
              <span :class="statusClass(row.projectStatus)">
                {{ masterDataStatusLabel(row.projectStatus) }}
              </span>
            </template>

            <template #safetyEducation="{ row }">
              <span :class="row.safetyEducation ? 'chip chip-ok' : 'chip chip-warn'">
                {{ row.safetyEducation ? '已完成' : '未完成' }}
              </span>
            </template>

            <template #action="{ row }">
              <div class="flex items-center justify-end gap-1">
                <NuxtLink
                  v-if="meta.detailPath"
                  :to="detailPath(row)"
                  class="icon-btn"
                  :aria-label="`查看${row.name}${meta.label}详情`"
                  title="详情"
                >
                  <span class="i-lucide-file-text text-14px" aria-hidden="true" />
                </NuxtLink>
                <NuxtLink
                  :to="`${meta.newPath}/${row.id}`"
                  class="icon-btn"
                  :aria-label="`编辑${row.name}${meta.label}`"
                  title="编辑"
                >
                  <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
                </NuxtLink>
                <button
                  type="button"
                  class="icon-btn-danger"
                  :aria-label="`删除${row.name}${meta.label}`"
                  title="删除"
                  @click="remove(row)"
                >
                  <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
                </button>
              </div>
            </template>
          </KitTable>
        </div>
      </template>
    </ListShell>
  </div>
</template>
