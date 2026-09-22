<script setup lang="ts" generic="T extends Record<string, any>">
// KitTable —— vxe-table 表格三件套封装(#51,设计稿 kit/KitTable.jsx 的 Nuxt 版):
// ① ≥minRows 行展示高度 ② 横滚只发生在表格容器内(页面不整体横滚,STYLE-GUIDE §6.4)
// ③ 分页条(页码 + 每页条数,受控:父组件持有 page/pageSize,本组件只 emit)。
// 列配置驱动,纯逻辑在 ~/lib/kit/table.ts;金额列 ¥#,##0.00 走 lib/util/money 的 yuan()。
import type { KitFilterOption, KitTableColumn, NormalizedKitColumn } from '~/lib/kit/table'
import { provide } from 'vue'
import { deriveFilterOptions, formatCell, normalizeKitColumn } from '~/lib/kit/table'
import { KIT_TABLE_VIEW_KEY } from '~/lib/kit/table-view'

interface KitTableEmptyState {
  title: string
  description?: string
  actionLabel?: string
}

interface KitTableResizeConfig {
  dragMode?: 'auto' | 'fixed'
  showDragTip?: boolean
  isDblclickAutoWidth?: boolean
  minWidth?: number
  maxWidth?: number
}

const {
  columns,
  data,
  loading = false,
  page,
  pageSizeOptions = [10, 20, 50],
  minRows = 10,
  rowKey = 'id',
  empty = '暂无数据',
  remoteFilter = false,
  checkMethod,
  resizable = true,
  rowHeight = 36,
  resizeConfig: resizeConfigInput,
  restoreScrollLeft,
} = defineProps<{
  columns: KitTableColumn[]
  data: T[]
  loading?: boolean
  /** 受控分页(页码 1 起始);缺省不渲染分页条。 */
  page?: { page: number, pageSize: number, total: number }
  pageSizeOptions?: number[]
  /** 最少展示行数的高度兜底(设计稿铁律 ≥10 行)。 */
  minRows?: number
  rowKey?: string
  empty?: string | KitTableEmptyState
  /** true = 列头筛选不在本地过滤,只 emit filter-change,由调用方对全量数据过滤(配受控分页)。 */
  remoteFilter?: boolean
  /** checkbox 列的行级可勾判定(如 excel 来源票无扫描件不可勾);缺省全部可勾。 */
  checkMethod?: (row: T) => boolean
  /** 是否允许列宽拖拽；固定操作列仍由列契约默认禁拖。 */
  resizable?: boolean
  /** 表头与数据行的统一高度；默认采用运行参考的 36px 紧凑密度。 */
  rowHeight?: number
  /** 领域表格可覆盖拖拽边界，或关闭双击自适配。 */
  resizeConfig?: KitTableResizeConfig
  /** 来源返回时，在 vxe 数据与列布局完成后恢复横向位置。 */
  restoreScrollLeft?: number
}>()

const emit = defineEmits<{
  pageChange: [payload: { page: number, pageSize: number }]
  filterChange: [payload: { field: string, values: unknown[], filters: { field: string, values: unknown[] }[] }]
  /** 勾选变化(含表头全选),携带当前全部选中行。 */
  checkboxChange: [rows: T[]]
  emptyAction: []
  viewRestored: []
}>()

defineSlots<Record<string, (props: { row: T, rowIndex: number }) => unknown> & {
  columnHeader: (props: { column: NormalizedKitColumn }) => unknown
}>()

// 列 props 一次性算好并缓存:v-bind 若每次渲染都产出新对象/新闭包,
// 会反复触发 vxe 内部列注册/布局,把主线程拖死。
const normalized = computed(() => columns.map((raw) => {
  const col = normalizeKitColumn(raw)
  const slot = cellSlot(col)
  return { col, slot, vxeProps: buildColProps(col, slot) }
}))

/** 表头 + 数据行使用同一紧凑高度，兜住 ≥minRows 行展示高度。 */
const effectiveRowHeight = computed(() => Math.max(32, rowHeight))
const minHeight = computed(() => effectiveRowHeight.value * (minRows + 1))
const rootStyle = computed(() => ({
  '--kit-table-row-height': `${effectiveRowHeight.value}px`,
}))
const rowConfig = computed(() => ({
  isHover: true,
  keyField: rowKey,
  height: effectiveRowHeight.value,
}))
const columnConfig = computed(() => ({ resizable }))
const effectiveResizeConfig = computed<KitTableResizeConfig>(() => ({
  dragMode: 'fixed',
  showDragTip: true,
  isDblclickAutoWidth: true,
  minWidth: 48,
  maxWidth: 480,
  ...resizeConfigInput,
}))
const emptyState = computed<KitTableEmptyState>(() =>
  typeof empty === 'string'
    ? {
        title: empty,
        description: '请调整筛选条件，或检查当前业务范围。',
      }
    : empty,
)

/** 跨页连续序号:seq 列从当前页偏移起算,而不是每页都从 1 开始。 */
const seqConfig = computed(() =>
  page ? { startIndex: (page.page - 1) * page.pageSize } : {},
)

function cellSlot(col: NormalizedKitColumn): string | undefined {
  return col.slot ?? (col.type === 'action' ? 'action' : undefined)
}

function filterOptionsFor(col: NormalizedKitColumn): KitFilterOption[] | undefined {
  if (!col.field)
    return undefined
  if (Array.isArray(col.filterable))
    return col.filterable
  if (col.filterable === true)
    return deriveFilterOptions(data, col.field)
  return undefined
}

function buildColProps(col: NormalizedKitColumn, slot: string | undefined): Record<string, unknown> {
  const p: Record<string, unknown> = {
    field: col.field,
    title: col.title,
    align: col.align,
  }
  if (col.width != null)
    p.width = col.width
  if (col.minWidth != null)
    p.minWidth = col.minWidth
  if (col.maxWidth != null)
    p.maxWidth = col.maxWidth
  // vxe-table 会在固定列容器中复制空态插槽，产生重复的 status 与可聚焦按钮。
  // 无数据时无需固定列，关闭 fixed 可确保空态只渲染一次。
  if (col.fixed && data.length > 0)
    p.fixed = col.fixed
  if (col.resizable != null)
    p.resizable = col.resizable
  if (col.className)
    p.className = col.className
  if (!slot)
    p.formatter = ({ cellValue }: { cellValue: unknown }) => formatCell(col, cellValue)
  const filters = filterOptionsFor(col)
  if (filters) {
    p.filters = filters
    if (!remoteFilter)
      p.filterMethod = ({ value, row }: { value: unknown, row: T }) => row[col.field!] === value
  }
  return p
}

// vxe 4.19 起 property 已标弃用,field 是现名;为兼容留 property 兜底。
interface VxeFilterChangeParams {
  field?: string
  property?: string
  values: unknown[]
  filterList: { field?: string, property?: string, values: unknown[] }[]
}

function onFilterChange(params: VxeFilterChangeParams) {
  emit('filterChange', {
    field: (params.field ?? params.property)!,
    values: params.values,
    filters: params.filterList.map(f => ({ field: (f.field ?? f.property)!, values: f.values })),
  })
}

// ── checkbox 列（#69 勾选浮出合计）──
const tableRef = useTemplateRef<{
  getCheckboxRecords: () => T[]
  clearCheckboxRow: () => void
  clearFilter?: () => Promise<void> | void
  setFilter?: (field: string, options: KitFilterOption[]) => Promise<void> | void
  recalculate?: (full?: boolean) => Promise<void>
  scrollTo?: (left: number) => Promise<void>
  getScroll?: () => { scrollLeft: number }
}>('tableRef')

provide(KIT_TABLE_VIEW_KEY, {
  scrollLeft: () => tableRef.value?.getScroll?.().scrollLeft ?? 0,
})

// vxe-column 只在注册时读取 filters；远程快照到达或 facet 更新后，
// 必须通过表格 API 同步选项，否则表头虽出现漏斗，面板仍保留旧的空列表。
async function syncFilterOptions(entries = normalized.value) {
  await nextTick()
  for (const { col } of entries) {
    if (col.field && Array.isArray(col.filterable))
      tableRef.value?.setFilter?.(col.field, col.filterable)
  }
}

onMounted(syncFilterOptions)
watch(normalized, syncFilterOptions, { flush: 'post' })

let viewRestoreGeneration = 0
async function restoreHorizontalScroll() {
  const generation = ++viewRestoreGeneration
  const left = restoreScrollLeft
  if (left == null || !Number.isFinite(left) || left < 0)
    return
  await nextTick()
  const table = tableRef.value
  await table?.recalculate?.(true)
  if (generation !== viewRestoreGeneration || !table || table !== tableRef.value)
    return
  await table.scrollTo?.(left)
  if (generation === viewRestoreGeneration && table === tableRef.value)
    emit('viewRestored')
}

watch(() => restoreScrollLeft, restoreHorizontalScroll, { flush: 'post' })

const checkboxConfig = computed(() =>
  checkMethod ? { checkMethod: ({ row }: { row: T }) => checkMethod(row) } : {},
)

function onCheckboxChange() {
  emit('checkboxChange', tableRef.value?.getCheckboxRecords() ?? [])
}

/** 清空勾选(如切换左树节点时由调用方触发),同步 emit 空选集。 */
function clearCheckbox() {
  tableRef.value?.clearCheckboxRow()
  emit('checkboxChange', [])
}

async function clearFilter() {
  await tableRef.value?.clearFilter?.()
}

defineExpose({ clearCheckbox, clearFilter })
</script>

<template>
  <div
    data-ui="kit-table"
    class="kit-table panel min-w-0 max-w-full overflow-hidden"
    :style="rootStyle"
  >
    <vxe-table
      ref="tableRef"
      :data="data"
      :loading="loading"
      :min-height="minHeight"
      :empty-text="emptyState.title"
      show-overflow="title"
      :row-config="rowConfig"
      :column-config="columnConfig"
      :resizable-config="effectiveResizeConfig"
      :filter-config="{ remote: remoteFilter }"
      :seq-config="seqConfig"
      :checkbox-config="checkboxConfig"
      @init-rendered="restoreHorizontalScroll"
      @data-rendered="restoreHorizontalScroll"
      @filter-change="onFilterChange"
      @checkbox-change="onCheckboxChange"
      @checkbox-all="onCheckboxChange"
    >
      <template #loading>
        <div
          data-ui="kit-table-loading"
          role="status"
          aria-label="正在加载表格数据"
          class="mx-auto w-[min(720px,80vw)] space-y-2 p-4"
        >
          <div
            v-for="index in 5"
            :key="index"
            aria-hidden="true"
            class="grid grid-cols-[16%_30%_22%_1fr] gap-3"
          >
            <span v-for="segment in 4" :key="segment" data-ui="kit-table-shimmer" class="kit-table__shimmer h-3" />
          </div>
        </div>
      </template>

      <template #empty>
        <div
          data-ui="kit-table-empty"
          role="status"
          :aria-label="emptyState.title"
          class="flex flex-col items-center justify-center px-6 py-10 text-center"
        >
          <span aria-hidden="true" class="i-lucide-inbox mb-2 h-7 w-7 text-ink-faint" />
          <strong class="text-14px font-700 text-ink">{{ emptyState.title }}</strong>
          <span v-if="emptyState.description" class="mt-1 text-12px text-ink-faint">
            {{ emptyState.description }}
          </span>
          <button
            v-if="emptyState.actionLabel"
            type="button"
            class="btn-primary mt-4"
            @click="emit('emptyAction')"
          >
            {{ emptyState.actionLabel }}
          </button>
        </div>
      </template>

      <template v-for="({ col, vxeProps, slot }, i) in normalized" :key="col.field ?? `${col.type}:${i}`">
        <vxe-column
          v-if="col.type === 'seq'"
          type="seq"
          :title="col.title"
          :width="col.width"
          :align="col.align"
          :fixed="col.fixed"
          :resizable="col.resizable"
        />
        <vxe-column
          v-else-if="col.type === 'checkbox'"
          type="checkbox"
          :title="col.title"
          :width="col.width"
          :align="col.align"
          :fixed="col.fixed"
          :resizable="col.resizable"
        />
        <vxe-column v-else v-bind="vxeProps">
          <template v-if="col.customHeader" #header>
            <slot name="columnHeader" :column="col" />
          </template>
          <template v-if="slot" #default="{ row, rowIndex }">
            <slot :name="slot" :row="row" :row-index="rowIndex" />
          </template>
        </vxe-column>
      </template>
    </vxe-table>

    <TablePager
      v-if="page"
      :total="page.total"
      :page="page.page"
      :page-size="page.pageSize"
      :page-size-options="pageSizeOptions"
      @update:page="p => emit('pageChange', { page: p, pageSize: page!.pageSize })"
      @update:page-size="s => emit('pageChange', { page: 1, pageSize: s })"
    />
  </div>
</template>

<style scoped>
.kit-table {
  width: 100%;
}

.kit-table :deep(.vxe-table) {
  width: 100%;
  max-width: 100%;
}

.kit-table :deep(.vxe-header--column),
.kit-table :deep(.vxe-body--column) {
  height: var(--kit-table-row-height);
}

/* 参考站的列宽手柄只属于当前列右缘，避免“拖左列还是右列”的含混。 */
.kit-table :deep(.vxe-header--column .vxe-cell--col-resizable) {
  right: -4px;
  width: 7px;
  cursor: col-resize;
  touch-action: none;
}

.kit-table :deep(.vxe-header--column .vxe-cell--col-resizable:hover::before),
.kit-table :deep(.vxe-header--column .vxe-cell--col-resizable:focus-visible::before) {
  height: 100%;
  background: var(--brand);
}

.kit-table__shimmer {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--surface-3);
}

.kit-table__shimmer::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 72%), transparent);
  content: "";
  animation: kit-table-shimmer 1.5s ease-in-out infinite;
  transform: translateX(-100%);
}

@keyframes kit-table-shimmer {
  to {
    transform: translateX(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .kit-table__shimmer::after {
    animation: none;
  }
}
</style>
