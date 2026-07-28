<script setup lang="ts" generic="T extends Record<string, any>">
// KitTable —— vxe-table 表格三件套封装(#51,设计稿 kit/KitTable.jsx 的 Nuxt 版):
// ① ≥minRows 行展示高度 ② 横滚只发生在表格容器内(页面不整体横滚,STYLE-GUIDE §6.4)
// ③ 分页条(页码 + 每页条数,受控:父组件持有 page/pageSize,本组件只 emit)。
// 列配置驱动,纯逻辑在 ~/lib/kit/table.ts;金额列 ¥#,##0.00 走 lib/util/money 的 yuan()。
import type { KitFilterOption, KitTableColumn, NormalizedKitColumn } from '~/lib/kit/table'
import { deriveFilterOptions, formatCell, normalizeKitColumn } from '~/lib/kit/table'

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
  empty?: string
  /** true = 列头筛选不在本地过滤,只 emit filter-change,由调用方对全量数据过滤(配受控分页)。 */
  remoteFilter?: boolean
  /** checkbox 列的行级可勾判定(如 excel 来源票无扫描件不可勾);缺省全部可勾。 */
  checkMethod?: (row: T) => boolean
}>()

const emit = defineEmits<{
  pageChange: [payload: { page: number, pageSize: number }]
  filterChange: [payload: { field: string, values: unknown[], filters: { field: string, values: unknown[] }[] }]
  /** 勾选变化(含表头全选),携带当前全部选中行。 */
  checkboxChange: [rows: T[]]
}>()

defineSlots<Record<string, (props: { row: T, rowIndex: number }) => unknown>>()

// 列 props 一次性算好并缓存:v-bind 若每次渲染都产出新对象/新闭包,
// 会反复触发 vxe 内部列注册/布局,把主线程拖死。
const normalized = computed(() => columns.map((raw) => {
  const col = normalizeKitColumn(raw)
  const slot = cellSlot(col)
  return { col, slot, vxeProps: buildColProps(col, slot) }
}))

/** 38px 表头 + 38px 数据行，字号增大后仍保持紧凑，兜住 ≥minRows 行展示高度。 */
const minHeight = computed(() => 38 + minRows * 38)

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
  if (col.fixed)
    p.fixed = col.fixed
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
const tableRef = useTemplateRef<{ getCheckboxRecords: () => T[], clearCheckboxRow: () => void }>('tableRef')

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

defineExpose({ clearCheckbox })
</script>

<template>
  <div class="panel min-w-0 overflow-hidden">
    <vxe-table
      ref="tableRef"
      :data="data"
      :loading="loading"
      :min-height="minHeight"
      :empty-text="empty"
      show-overflow="title"
      :row-config="{ isHover: true, keyField: rowKey }"
      :column-config="{ resizable: true }"
      :filter-config="{ remote: remoteFilter }"
      :seq-config="seqConfig"
      :checkbox-config="checkboxConfig"
      @filter-change="onFilterChange"
      @checkbox-change="onCheckboxChange"
      @checkbox-all="onCheckboxChange"
    >
      <template v-for="({ col, vxeProps, slot }, i) in normalized" :key="col.field ?? `${col.type}:${i}`">
        <vxe-column
          v-if="col.type === 'seq'"
          type="seq"
          :title="col.title"
          :width="col.width"
          :align="col.align"
          :fixed="col.fixed"
        />
        <vxe-column
          v-else-if="col.type === 'checkbox'"
          type="checkbox"
          :title="col.title"
          :width="col.width"
          :align="col.align"
          :fixed="col.fixed"
        />
        <vxe-column v-else v-bind="vxeProps">
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
