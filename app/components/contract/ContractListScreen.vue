<script setup lang="ts">
// 合同三列表共用屏（#90 批A）：kind 一份 meta 生成整页——蓝本 DC 设计稿
// {ConContract,SubContract,MatContract}Screen.jsx 的 EntityListScreen 范式。
// 口径差异全部收在 kindLabels（施工=开票/收款/应收，支出侧=收票/支付/应付）；
// 分包页多「劳务/专业」左分类与「类别」列；材采底部汇总为三段（红圈口径）。
import type { ContractKind } from '~/lib/contract/status'
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import type { StatusTone } from '~/lib/project/status'
import type { Contract } from '~/stores/contract'
import { Button } from '~/components/ui/button'
import { CONTRACT_STATUS_TONE, CONTRACT_STATUSES, CONTRACT_SUB_KINDS, contractBalance, kindLabels, sumField } from '~/lib/contract/status'
import { clampPage, paginate } from '~/lib/kit/table'
import { yuan } from '~/lib/util/money'

const { kind } = defineProps<{ kind: ContractKind }>()

const store = useContractStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const { confirm, undoToast, error } = useKitUI()
const { openContractForm } = useContractForm()

const KIND_TITLE: Record<ContractKind, string> = {
  施工: '施工合同',
  分包: '分包合同',
  材采: '材料采购合同',
}
const title = computed(() => KIND_TITLE[kind])
const labels = computed(() => kindLabels(kind))
const kindRows = computed(() => store.byKind(kind))

// ── 筛选状态：搜索 / 项目 / 业务态视图（默认履约中）/ 分包左分类 ──
const searchText = shallowRef('')
const projFilter = shallowRef('all') // reka Select 不接受空串值，'all' 哨兵
const view = shallowRef('履约中') // 默认业务态视图 = 履约中（设计稿 defaultView: 'active'）
const subCat = shallowRef('all') // 分包左分类：all | 劳务 | 专业

const projOptions = computed(() => [
  { key: 'all', label: '全部项目' },
  ...projectStore.list.map(p => ({ key: p.id, label: p.name })),
])

// ── 数据管线：kind 切片 → 项目/搜索 → （分包）分类 → 视图 → 分页 ──
const searched = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const proj = projFilter.value
  return kindRows.value.filter((c) => {
    if (proj !== 'all' && c.projectId !== proj)
      return false
    if (!q)
      return true
    return c.name.toLowerCase().includes(q) || c.no.toLowerCase().includes(q)
  })
})

const catRows = computed(() =>
  kind === '分包' && subCat.value !== 'all'
    ? searched.value.filter(c => c.subKind === subCat.value)
    : searched.value,
)

const viewTabs = computed(() => [
  { key: 'all', label: '全部', count: catRows.value.length },
  ...CONTRACT_STATUSES.map(s => ({
    key: s,
    label: s,
    count: catRows.value.filter(c => c.status === s).length,
  })),
])

const filtered = computed(() =>
  view.value === 'all' ? catRows.value : catRows.value.filter(c => c.status === view.value),
)

// 分包左分类（计数口径：项目/搜索/视图已生效、分类本身除外）
const catItems = computed<TreeNode[]>(() => {
  const inView = (rows: Contract[]) =>
    view.value === 'all' ? rows : rows.filter(c => c.status === view.value)
  const base = inView(searched.value)
  return [
    { key: 'all', label: `全部${title.value}`, icon: 'i-lucide-folder', count: base.length },
    ...CONTRACT_SUB_KINDS.map(s => ({
      key: s,
      label: `${s}分包`,
      icon: 'i-lucide-wrench',
      count: base.filter(c => c.subKind === s).length,
    })),
  ]
})

// ── 受控分页（KitTable 三件套，ADR 0009）──
const page = shallowRef(1)
const pageSize = shallowRef(10)
const curPage = computed(() => clampPage(page.value, filtered.value.length, pageSize.value))
const pageRows = computed(() => paginate(filtered.value, curPage.value, pageSize.value))

function onPageChange(e: { page: number, pageSize: number }) {
  page.value = e.page
  pageSize.value = e.pageSize
}
// 筛选/视图变化后回到第 1 页
watch([searchText, projFilter, view, subCat], () => {
  page.value = 1
})

// ── 列配置（vxe 列 props 必须缓存：KitTable 内部 computed 归一化，这里同样 computed）──
const columns = computed<KitTableColumn[]>(() => {
  const cols: KitTableColumn[] = [
    { title: '#', type: 'seq', fixed: 'left' },
    { field: 'name', title: '合同名称', minWidth: 200, fixed: 'left', slot: 'name' },
    { field: 'no', title: '合同编号', width: 170 },
    { field: 'projectId', title: '项目名称', width: 150, slot: 'project' },
  ]
  if (kind === '施工')
    cols.push({ field: 'client', title: labels.value.party, minWidth: 170, slot: 'client' })
  else
    cols.push({ field: 'supplierId', title: labels.value.party, minWidth: 190, slot: 'supplier' })
  if (kind === '分包')
    cols.push({ field: 'subKind', title: '类别', width: 84 })
  cols.push(
    { field: 'amount', title: kind === '分包' ? '含税合价' : '含税合同金额', type: 'money', width: 130 },
    { field: 'changed', title: '变更后合同金额', type: 'money', width: 130 },
    { field: 'settled', title: '累计结算', type: 'money', width: 130 },
    { field: 'invoiced', title: labels.value.invoiced, type: 'money', width: 130 },
    { field: 'paid', title: labels.value.paid, type: 'money', width: 130 },
    { field: 'balance', title: labels.value.balance, width: 130, align: 'right', slot: 'balance' },
    { field: 'signDate', title: '签约日期', type: 'date' },
    { field: 'status', title: '合同状态', width: 96, slot: 'status' },
    { title: '操作', type: 'action' },
  )
  return cols
})

// ── 底部多段汇总（对当前筛选后的全量行求和，非当前页）──
const summary = computed(() => {
  const rows = filtered.value
  if (kind === '材采') {
    // 红圈口径：材采三段（变更后合同金额/累计收票/累计支付）
    return [
      { label: '变更后合同金额总和', value: sumField(rows, 'changed') },
      { label: '累计收票金额总和', value: sumField(rows, 'invoiced') },
      { label: '累计支付金额总和', value: sumField(rows, 'paid') },
    ]
  }
  return [
    { label: '变更后合同金额总和', value: sumField(rows, 'changed') },
    { label: '累计结算总和', value: sumField(rows, 'settled') },
    { label: `${labels.value.invoiced}总和`, value: sumField(rows, 'invoiced') },
    { label: `${labels.value.paid}总和`, value: sumField(rows, 'paid') },
  ]
})

// 状态 chip（语义色调 → chip class，色调映射见 ~/lib/contract/status）
const TONE_CHIP: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  muted: 'chip bg-surface-3 text-ink-faint',
  ok: 'chip-ok',
}
function statusChip(status: string): string {
  const tone = CONTRACT_STATUS_TONE[status]
  return tone ? TONE_CHIP[tone] : 'chip-brand'
}

function projectName(id: string): string {
  return projectStore.byId(id)?.name ?? '—'
}
function projectDeveloper(id: string): string {
  return projectStore.byId(id)?.developer || '—'
}
function supplierName(id: string | null): string {
  return id ? supplierStore.byId(id)?.name ?? '—' : '—'
}

// ── CRUD ──
function openCreate() {
  openContractForm(kind)
}

async function refresh() {
  searchText.value = ''
  projFilter.value = 'all'
  view.value = '履约中'
  subCat.value = 'all'
  await Promise.all([store.load(), projectStore.load(), supplierStore.load()])
}
function openEdit(row: Contract) {
  openContractForm(kind, row)
}

// 合同无下游子表（PARENT_REFS 中无表指向 contracts）→ 一律 simple confirm + 10 秒 undoToast（ADR 0003）
async function handleDelete(row: Contract) {
  const ok = await confirm({
    variant: 'simple',
    title: `删除${title.value}`,
    message: `确认删除「${row.name}」？删除后可在 10 秒内撤回。`,
    confirmLabel: '删除',
  })
  if (!ok)
    return
  const logId = await store.remove(row.id)
  if (!logId) {
    error('删除失败：合同不存在或已删除')
    return
  }
  undoToast(`已删除「${row.name}」`, () => store.undo(logId))
}

onMounted(() => {
  store.load()
  projectStore.load()
  supplierStore.load()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <section
      class="flex flex-wrap items-center gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3.5 shadow-[var(--shadow-card)]"
    >
      <div class="mr-1 flex flex-none items-baseline gap-2">
        <h2 class="text-14px font-800 text-ink">
          {{ title }}
        </h2>
        <span class="text-12px text-ink-soft">
          共 <b class="font-mono text-ink">{{ kindRows.length }}</b> 份
          <template v-if="filtered.length !== kindRows.length">· 当前 {{ filtered.length }} 份</template>
        </span>
      </div>

      <SelectFilter
        v-model="projFilter"
        label="项目"
        :options="projOptions"
        placeholder="全部项目"
        :min-width="160"
      />

      <div class="ml-auto flex flex-wrap items-center gap-2.5">
        <SearchInput v-model="searchText" placeholder="搜索合同名称 / 编号" :width="220" />
        <Button variant="outline" size="icon" title="刷新" :disabled="store.loading" @click="refresh">
          <span
            class="i-lucide-refresh-cw h-3.5 w-3.5"
            :class="store.loading ? 'animate-spin' : ''"
            aria-hidden="true"
          />
          <span class="sr-only">刷新</span>
        </Button>
        <Button @click="openCreate">
          <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
          新增{{ title }}
        </Button>
      </div>
    </section>

    <!-- 业务态视图（默认履约中） -->
    <div class="rounded-[var(--radius-card)] border border-line bg-panel px-3 shadow-[var(--shadow-card)]">
      <SegTab v-model="view" :tabs="viewTabs" />
    </div>

    <div :class="kind === '分包' ? 'flex items-start gap-3' : ''">
      <!-- 分包页：劳务/专业左分类 -->
      <div v-if="kind === '分包'" class="w-52 shrink-0 overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
        <TreeNav v-model="subCat" title="分包合同分类" :items="catItems" />
      </div>

      <div class="min-w-0 flex-1">
        <KitTable
          class="overflow-hidden rounded-[var(--radius-card)] shadow-[var(--shadow-card)]"
          :columns="columns"
          :data="pageRows"
          :loading="store.loading"
          :page="{ page: curPage, pageSize, total: filtered.length }"
          @page-change="onPageChange"
        >
          <template #name="{ row }">
            <NuxtLink :to="`/contract/${row.id}`" class="cell--link">
              {{ row.name }}
            </NuxtLink>
          </template>
          <template #project="{ row }">
            <NuxtLink :to="`/project/${row.projectId}`" class="cell--link">
              {{ projectName(row.projectId) }}
            </NuxtLink>
          </template>
          <template #client="{ row }">
            {{ projectDeveloper(row.projectId) }}
          </template>
          <template #supplier="{ row }">
            <NuxtLink v-if="row.supplierId" :to="`/base/supplier/${row.supplierId}`" class="cell--link">
              {{ supplierName(row.supplierId) }}
            </NuxtLink>
            <span v-else>—</span>
          </template>
          <template #balance="{ row }">
            <span
              class="font-mono font-600 tabular-nums"
              :class="contractBalance(row) > 0 ? 'text-danger-ink' : 'text-ink'"
            >{{ yuan(contractBalance(row)) }}</span>
          </template>
          <template #status="{ row }">
            <span class="chip" :class="statusChip(row.status)">{{ row.status }}</span>
          </template>
          <template #action="{ row }">
            <div class="flex items-center gap-1">
              <NuxtLink :to="`/contract/${row.id}`" class="icon-btn" title="详情">
                <span class="i-lucide-file-text text-14px" />
              </NuxtLink>
              <button class="icon-btn" title="编辑" @click="openEdit(row)">
                <span class="i-lucide-square-pen text-14px" />
              </button>
              <button class="icon-btn-danger" title="删除" @click="handleDelete(row)">
                <span class="i-lucide-trash-2 text-14px" />
              </button>
            </div>
          </template>
        </KitTable>

        <!-- 底部多段汇总行（当前筛选后的全量口径） -->
        <div class="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 border border-line rounded-[var(--radius-card)] bg-panel px-3 py-2.5 shadow-[var(--shadow-card)]">
          <span class="text-12px text-ink-faint">共 {{ filtered.length }} 份</span>
          <span v-for="seg in summary" :key="seg.label" class="text-12px text-ink-soft">
            {{ seg.label }}
            <span class="ml-1 font-mono font-700 tabular-nums text-ink">{{ yuan(seg.value) }}</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
