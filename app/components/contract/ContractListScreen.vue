<script setup lang="ts">
import type { F2FormKind } from '~/lib/contract/forms'
// 合同三列表共用屏（#90 批A）：kind 一份 meta 生成整页——蓝本 DC 设计稿
// {ConContract,SubContract,MatContract}Screen.jsx 的 EntityListScreen 范式。
// 口径差异全部收在 kindLabels（施工=开票/收款/应收，支出侧=收票/支付/应付）；
// 分包页多「劳务/专业」左分类与「类别」列；材采底部汇总为三段（红圈口径）。
import type { ContractKind } from '~/lib/contract/status'
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import type { StatusTone } from '~/lib/project/status'
import type { Contract } from '~/stores/contract'
import KitEnumFilterOptions from '~/components/ui/KitEnumFilterOptions.vue'
import { formPath } from '~/lib/contract/page'
import { CONTRACT_STATUS_TONE, CONTRACT_STATUSES, CONTRACT_SUB_KINDS, contractBalance, kindLabels, sumField } from '~/lib/contract/status'
import { clampPage, paginate } from '~/lib/kit/table'
import { yuan } from '~/lib/util/money'

const { kind } = defineProps<{ kind: ContractKind }>()

const store = useContractStore()
const { confirm, undoToast, error } = useKitUI()

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
const projFilter = shallowRef<string[]>([])
const partyFilter = shallowRef<string[]>([])
const view = shallowRef<string[]>(['履约中']) // 保留既有默认业务视图，真实选中条件在筛选器中明确显示。
const subCat = shallowRef<string[]>([])

const projOptions = computed(() => [
  { key: 'all', label: '全部项目' },
  ...[...new Map(kindRows.value.map(row => [
    row.projectId,
    { key: row.projectId, label: row.projectName || row.projectId },
  ])).values()],
])
const partyLabel = computed(() => kind === '施工' ? '客户' : '分供方')
const partyOptions = computed(() => {
  const rows = kindRows.value
    .map(row => kind === '施工'
      ? { key: row.customerId ?? '', label: row.customerName }
      : { key: row.supplierId ?? '', label: row.supplierName })
    .filter(option => option.key && option.label)
  return [
    { key: 'all', label: `全部${partyLabel.value}` },
    ...[...new Map(rows.map(option => [option.key, option])).values()],
  ]
})

// ── 数据管线：kind 切片 → 项目/搜索 → （分包）分类 → 视图 → 分页 ──
const searched = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const proj = projFilter.value
  return kindRows.value.filter((c) => {
    if (proj.length && !proj.includes(c.projectId))
      return false
    const partyId = kind === '施工' ? c.customerId : c.supplierId
    if (partyFilter.value.length && (!partyId || !partyFilter.value.includes(partyId)))
      return false
    if (!q)
      return true
    return c.name.toLowerCase().includes(q) || c.no.toLowerCase().includes(q)
  })
})

const catRows = computed(() =>
  kind === '分包' && subCat.value.length
    ? searched.value.filter(c => subCat.value.includes(c.subKind ?? ''))
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
const viewOptions = computed(() =>
  viewTabs.value.map(item => ({
    key: item.key,
    label: `${item.label} ${item.count}`,
  })),
)

const filtered = computed(() =>
  view.value.length === 0 ? catRows.value : catRows.value.filter(c => view.value.includes(c.status)),
)

// 分包左分类（计数口径：项目/搜索/视图已生效、分类本身除外）
const catItems = computed<TreeNode[]>(() => {
  const inView = (rows: Contract[]) =>
    view.value.length === 0 ? rows : rows.filter(c => view.value.includes(c.status))
  const base = inView(searched.value)
  if (kind === '材采') {
    return [
      {
        key: 'all',
        label: '全部材料采购合同',
        icon: 'i-lucide-folder',
        count: base.length,
      },
    ]
  }
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
watch([searchText, projFilter, partyFilter, view, subCat], () => {
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
    { title: '操作', type: 'action', width: 56 },
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
  return kindRows.value.find(row => row.projectId === id)?.projectName || '—'
}

// ── CRUD ──
function openCreate() {
  void navigateTo(formPath(formKind()))
}

async function refresh() {
  searchText.value = ''
  projFilter.value = []
  partyFilter.value = []
  view.value = ['履约中']
  subCat.value = []
  await store.load()
}
function openEdit(row: Contract) {
  void navigateTo(formPath(formKind(), row.id))
}

const rowActions = [
  { key: 'detail', label: '查看详情', icon: 'i-lucide-file-text' },
  { key: 'edit', label: '编辑', icon: 'i-lucide-square-pen' },
  { key: 'delete', label: '删除', icon: 'i-lucide-trash-2', tone: 'danger' as const },
] as const

async function handleRowAction(action: string, row: Contract) {
  if (action === 'detail') {
    await navigateTo(`/contract/${row.id}`)
    return
  }
  if (action === 'edit') {
    openEdit(row)
    return
  }
  if (action === 'delete') {
    await handleDelete(row)
    restoreRowActionFocus(row)
  }
}

function restoreRowActionFocus(row: Contract) {
  window.setTimeout(() => {
    const label = `${row.name}合同操作`
    const trigger = [...document.querySelectorAll<HTMLElement>('[data-ui="row-action-menu-trigger"]')]
      .find(element =>
        element.getAttribute('aria-label') === label
        && element.offsetParent !== null,
      )
    trigger?.focus()
  })
}

function formKind(): F2FormKind {
  const values: Record<ContractKind, F2FormKind> = {
    施工: 'construction',
    分包: 'subcontract',
    材采: 'material',
  }
  return values[kind]
}

// 普通删除先由领域 action 检查结算、付款、发票、BOQ 等真实下游，再提供 10 秒撤回。
async function handleDelete(row: Contract) {
  const ok = await confirm({
    variant: 'simple',
    title: `删除${title.value}`,
    message: `确认删除「${row.name}」？删除后可在 10 秒内撤回。`,
    confirmLabel: '删除',
  })
  if (!ok)
    return
  try {
    const logId = await store.removeForm(formKind(), row.id)
    if (!logId) {
      error('删除失败：合同不存在或已删除')
      return
    }
    undoToast(`已删除「${row.name}」`, () => store.undoForm(formKind(), logId))
  }
  catch (cause) {
    error(cause instanceof Error ? cause.message : '删除失败')
  }
}

onMounted(() => {
  store.load()
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <ContractListToolbar
      v-model:search="searchText"
      v-model:project="projFilter"
      v-model:party="partyFilter"
      v-model:status="view"
      :title="title"
      :loading="store.loading"
      :project-options="projOptions"
      :party-label="partyLabel"
      :party-options="partyOptions"
      :status-options="viewOptions"
      @refresh="refresh"
      @create="openCreate"
    />

    <div :class="kind !== '施工' ? 'grid min-w-0 gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-start' : ''">
      <!-- 分包按劳务/专业分类；材采保留参考页的单层合同分类。 -->
      <div v-if="kind !== '施工'" class="min-w-0 sm:w-52">
        <div class="panel p-3">
          <span class="mb-2 block text-12px font-600">{{ kind === '材采' ? '材料采购合同' : '分包合同分类' }}</span>
          <KitEnumFilterOptions v-if="kind === '分包'" v-model="subCat" label="分包类别" :options="catItems.filter(item => item.key !== 'all').map(item => ({ key: item.key, label: item.label }))" />
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <KitTable
          :columns="columns"
          :data="pageRows"
          :loading="store.loading"
          :page="{ page: curPage, pageSize, total: filtered.length }"
          @page-change="onPageChange"
        >
          <template #name="{ row }">
            <NuxtLink :to="`/contract/${row.id}`" class="cell--link" :title="row.name">
              {{ row.name }}
            </NuxtLink>
          </template>
          <template #project="{ row }">
            <NuxtLink :to="`/project/${row.projectId}`" class="cell--link">
              {{ projectName(row.projectId) }}
            </NuxtLink>
          </template>
          <template #client="{ row }">
            <NuxtLink v-if="row.customerId" :to="`/base/customer/${row.customerId}`" class="cell--link">
              {{ row.customerName || '—' }}
            </NuxtLink>
            <span v-else>—</span>
          </template>
          <template #supplier="{ row }">
            <NuxtLink v-if="row.supplierId" :to="`/base/supplier/${row.supplierId}`" class="cell--link">
              {{ row.supplierName || '—' }}
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
            <RowActionMenu
              :items="rowActions"
              :label="`${row.name}合同操作`"
              @select="handleRowAction($event, row)"
            />
          </template>
        </KitTable>

        <ContractListSummary :total="filtered.length" :items="summary" />
      </div>
    </div>
  </div>
</template>
