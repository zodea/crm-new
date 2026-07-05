<script setup lang="ts">
// 隐藏 dev 演示路由(不在侧边栏 NAV_GROUPS 中):KitTable 表格三件套验证载体(#51)。
// 访问 /dev/kit-table —— 与 /dev/kit-ui、/dev/kit-atoms 并列。
// 验收对照:①容器内横滚(页面主体无横向滚动条) ②分页(页码+条数) ③金额 ¥#,##0.00
// ④列头筛选 + 行操作插槽 ⑤13+ 列宽表样例。
import type { KitTableColumn } from '~/lib/kit/table'
import { clampPage, deriveFilterOptions, paginate } from '~/lib/kit/table'

// —— 样例数据:红圈项目列表口径,57 条(需要分页与横滚的真实体量) ——
const NAMES = ['合和新城', '锦绣江南', '翡翠湾', '云璟台', '龙湖天街', '滨江壹号', '紫金华府', '中央公园里', '天悦城', '麓山院', '江山赋', '观澜府']
const CLIENTS = ['广州城投置业', '保利华南', '越秀地产', '珠江实业', '中海地产', '时代控股']
const MANAGERS = ['陈志远', '李建国', '王海峰', '赵明轩', '刘德胜']
const REGIONS = ['广州', '佛山', '东莞', '深圳', '惠州']
const TYPES = ['自营', '联营']
const STATUSES = ['筹备中', '施工中', '停工', '已竣工', '已结算']

const STATUS_COLOR: Record<string, string> = {
  筹备中: 'cell--status-warn',
  施工中: 'text-brand font-600',
  停工: 'text-ink-faint font-600',
  已竣工: 'cell--status-ok',
  已结算: 'cell--status-ok',
}

interface DemoProject {
  id: number
  code: string
  name: string
  client: string
  manager: string
  operationType: string
  region: string
  status: string
  contractAmount: number
  received: number
  receivable: number
  invoiced: number
  startPlan: string
  endPlan: string
  note: string
  [key: string]: unknown
}

const pad = (n: number) => String(n).padStart(2, '0')
const round2 = (n: number) => Math.round(n * 100) / 100

const ALL_ROWS: DemoProject[] = Array.from({ length: 57 }, (_, i) => {
  const contractAmount = round2(3_600_000 + i * 1_234_567.89)
  const received = round2(contractAmount * (0.2 + (i % 8) * 0.12))
  return {
    id: i + 1,
    code: `PRJ-2026-${String(i + 1).padStart(3, '0')}`,
    name: `${NAMES[i % NAMES.length]}${Math.floor(i / NAMES.length) + 1}期`,
    client: CLIENTS[i % CLIENTS.length]!,
    manager: MANAGERS[i % MANAGERS.length]!,
    operationType: TYPES[i % TYPES.length]!,
    region: REGIONS[i % REGIONS.length]!,
    status: STATUSES[i % STATUSES.length]!,
    contractAmount,
    received,
    receivable: round2(contractAmount - received),
    invoiced: round2(received * 0.87),
    startPlan: `2026-${pad((i % 12) + 1)}-${pad((i % 28) + 1)}`,
    endPlan: `2027-${pad((i % 12) + 1)}-${pad((i * 3 % 28) + 1)}`,
    note: i % 4 === 0 ? '含地下室两层,基坑支护专项方案已评审;雨季施工注意排水' : i % 3 === 0 ? '' : '正常推进',
  }
})

// 受控分页下,筛选选项从全量数据推导(而非当前页)
const wideColumns: KitTableColumn[] = [
  { title: '#', type: 'seq', fixed: 'left' },
  { field: 'name', title: '项目名称', minWidth: 150, fixed: 'left', slot: 'name' },
  { field: 'code', title: '项目编号', width: 120 },
  { field: 'status', title: '状态', width: 90, filterable: deriveFilterOptions(ALL_ROWS, 'status'), slot: 'status' },
  { field: 'client', title: '客户', minWidth: 130 },
  { field: 'manager', title: '项目经理', width: 96 },
  { field: 'operationType', title: '经营类型', width: 96, filterable: deriveFilterOptions(ALL_ROWS, 'operationType') },
  { field: 'region', title: '工程地域', width: 96, filterable: deriveFilterOptions(ALL_ROWS, 'region') },
  { field: 'contractAmount', title: '合同金额', type: 'money', width: 140 },
  { field: 'received', title: '已收款', type: 'money', width: 140 },
  { field: 'receivable', title: '应收余额', type: 'money', width: 140 },
  { field: 'invoiced', title: '已开票', type: 'money', width: 140 },
  { field: 'startPlan', title: '计划开工', type: 'date' },
  { field: 'endPlan', title: '计划竣工', type: 'date' },
  { field: 'note', title: '备注', minWidth: 200 },
  { title: '操作', type: 'action', width: 96 },
]

// —— 全量数据管线(remote 筛选 + 受控分页):筛选 → 钳页码 → 切片 ——
const activeFilters = ref<Record<string, unknown[]>>({})
const page = ref(1)
const pageSize = ref(10)

const filtered = computed(() => ALL_ROWS.filter(row =>
  Object.entries(activeFilters.value).every(([field, values]) =>
    !values.length || values.includes(row[field]),
  ),
))
const curPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, curPage.value, pageSize.value))

function onPageChange(e: { page: number, pageSize: number }) {
  page.value = e.page
  pageSize.value = e.pageSize
}

function onFilterChange(e: { filters: { field: string, values: unknown[] }[] }) {
  activeFilters.value = Object.fromEntries(e.filters.map(f => [f.field, f.values]))
  page.value = 1
}

const toast = useToast()

// —— 小表:少行数据 minRows 高度兜底 + 本地筛选(filterable: true) ——
const fewRows = ALL_ROWS.slice(0, 3)
const fewColumns: KitTableColumn[] = [
  { title: '#', type: 'seq' },
  { field: 'name', title: '项目名称', minWidth: 150 },
  { field: 'status', title: '状态', width: 100, filterable: true },
  { field: 'contractAmount', title: '合同金额', type: 'money', minWidth: 140 },
  { field: 'startPlan', title: '计划开工', type: 'date' },
]
</script>

<template>
  <div class="mx-auto max-w-5xl py-4">
    <header class="mb-5">
      <div class="flex items-center gap-2">
        <span class="i-lucide-table-2 text-16px text-brand" />
        <h1 class="text-16px font-800 text-ink">KitTable 表格三件套演示</h1>
        <span class="chip text-9px bg-warn-soft text-warn-ink">DEV ONLY</span>
      </div>
      <p class="text-12px text-ink-soft mt-1">
        隐藏路由 <code class="text-11px bg-surface-3 px-1 py-0.5">/dev/kit-table</code>,
        vxe-table 三件套封装(FEEDBACK-8 铁律:≥10 行高度 / 容器内横滚 / 分页)。
      </p>
    </header>

    <div class="space-y-3">
      <!-- ① 宽表全家桶 -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">① 16 列宽表 —— 容器内横滚 + 受控分页 + 列头筛选(remote)+ 金额列 + 插槽</h2>
        <p class="text-12px text-ink-soft mb-3">
          57 条 × 16 列(约 1.9 倍容器宽):横向滚动只发生在表格容器内,页面主体不出横滚条;
          seq/项目名称左固定、操作列右固定;状态/经营类型/地域列头可筛(选项来自<b>全量数据</b>,筛后回第 1 页);
          金额四列 <b>¥#,##0.00</b>;分页支持页码 + 10/20/50 条/页。
        </p>
        <KitTable
          :columns="wideColumns"
          :data="pageRows"
          :page="{ page: curPage, pageSize, total: filtered.length }"
          remote-filter
          @page-change="onPageChange"
          @filter-change="onFilterChange"
        >
          <template #name="{ row }">
            <span class="cell--link" @click="toast.info(`打开项目:${row.name}`)">{{ row.name }}</span>
          </template>
          <template #status="{ row }">
            <span :class="STATUS_COLOR[row.status as string] || ''">{{ row.status }}</span>
          </template>
          <template #action="{ row }">
            <div class="flex items-center gap-1">
              <button class="icon-btn" title="编辑" @click="toast.info(`编辑 ${row.code}`)">
                <span class="i-lucide-square-pen text-14px" />
              </button>
              <button class="icon-btn-danger" title="删除" @click="toast.warning(`删除 ${row.code}(演示)`)">
                <span class="i-lucide-trash-2 text-14px" />
              </button>
            </div>
          </template>
        </KitTable>
        <p class="text-11px text-ink-faint font-mono mt-2">
          filters = {{ activeFilters }} · page = {{ curPage }} / size = {{ pageSize }} · filtered = {{ filtered.length }}
        </p>
      </section>

      <!-- ② 少行兜底 + 本地筛选 -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">② 3 行数据 —— minRows 高度兜底(≥10 行)+ 本地筛选(filterable: true)</h2>
        <p class="text-12px text-ink-soft mb-3">数据不足时表体高度不塌陷;状态列头筛选在组件内本地过滤,选项自动从数据推导。</p>
        <KitTable :columns="fewColumns" :data="fewRows" />
      </section>

      <!-- ③ 空数据 -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">③ 空数据 —— empty 占位</h2>
        <KitTable :columns="fewColumns" :data="[]" :min-rows="6" empty="暂无项目,点击右上角「新增」创建" />
      </section>
    </div>
  </div>
</template>
