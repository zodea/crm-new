<script setup lang="ts">
// 发票台账（#69）：左树（按归属，只带张数角标）+ 右表 KitTable / 卡片视图切换 +
// 勾选浮出合计（平时无常驻金额汇总）+ 行软删撤回。
// 口径：台账 = 已归档（DATABASE.md §4.2）；「待归档」= 已校对未归档过渡态（#57，
// 替代设计稿旧模型的「未归项目」——两态模型下归档必有归属，见 issue #69 评论）。
import type { InvoiceLedgerExportRow, InvoiceXlsxStyleConfig } from '~/lib/invoice/excel'
import type { ProjectGroupKey } from '~/lib/invoice/ledger-nodes'
import type { InvoicePrintRequest } from '~/lib/invoice/print-layout'
import type { KitTableColumn } from '~/lib/kit/table'
import type { TreeNode } from '~/lib/kit/tree-nav'
import type { Invoice } from '~/stores/invoice'
import { createInvoiceLedgerXlsxFromRows, INVOICE_XLSX_MIME, invoiceLedgerRows } from '~/lib/invoice/excel'
import { ledgerNodeFromQuery, projectGroupKeyFromNode, projectTreeNodeKey } from '~/lib/invoice/ledger-nodes'
import { toErrorMessage } from '~/lib/util/error'
import { toLocalDateInputValue } from '~/lib/util/local-date'
import { yuan } from '~/lib/util/money'

const store = useInvoiceStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const router = useRouter()
const route = useRoute()
const { confirm, error, exportFile, formModal, openImportTab, success, undoToast, warning } = useKitUI()
const exportPreviewOpen = shallowRef(false)
const exportPreviewRows = shallowRef<InvoiceLedgerExportRow[]>([])
const exportPreviewFileName = shallowRef('')
const exportSaving = shallowRef(false)
const exportPreviewTotal = computed(() => exportPreviewRows.value.reduce((sum, row) => sum + row.totalAmount, 0))
const printMode = shallowRef(false)
const pendingPrint = shallowRef<InvoicePrintRequest | null>(null)
const printSelectedId = shallowRef<string | null>(null)

// ── 左树：全部 / 项目一级 / 个人开支 / 待归档 ──
const node = shallowRef('__all')
const searchText = shallowRef('')
const view = shallowRef<'table' | 'card'>('table')

const groups = computed(() => store.ledgerGroups)

interface ProjectLedgerGroup {
  key: ProjectGroupKey
  label: string
  count: number
}

function projectGroupKey(inv: Invoice): ProjectGroupKey {
  return inv.projectId ? `id:${inv.projectId}` : `name:${inv.projectName}`
}

// query 预筛（specs §07）：?project=<id> 直达对应项目节点；预筛不进页签身份，
// 页签复用后同一实例收到新 query，靠 watch 应用。
watch(
  () => ledgerNodeFromQuery(route.query),
  (target) => {
    if (target)
      node.value = target
  },
  { immediate: true },
)

const projectGroups = computed<ProjectLedgerGroup[]>(() => {
  const result = new Map<string, ProjectLedgerGroup>()
  for (const inv of groups.value.project) {
    const key = projectGroupKey(inv)
    const current = result.get(key)
    if (current) {
      current.count++
      continue
    }
    const canonicalProject = inv.projectId
      ? projectStore.list.find(project => project.id === inv.projectId)
      : undefined
    result.set(key, {
      key,
      label: canonicalProject?.name || inv.projectName || '未命名项目',
      count: 1,
    })
  }
  return [...result.values()]
})

const allRows = computed(() =>
  [...groups.value.project, ...groups.value.personal, ...groups.value.unassigned],
)

const treeItems = computed<TreeNode[]>(() => [
  { key: '__all', label: '全部', icon: 'i-lucide-layers', count: allRows.value.length },
  ...projectGroups.value.map(group => ({
    key: projectTreeNodeKey(group.key),
    label: group.label,
    icon: 'i-lucide-folder',
    count: group.count,
  })),
  { key: '__own', label: '个人开支', icon: 'i-lucide-user', count: groups.value.personal.length, tone: 'brand' as const },
  { key: '__pending', label: '待归档', icon: 'i-lucide-alert-triangle', count: groups.value.unassigned.length, tone: 'warn' as const },
])

const nodeRows = computed(() => {
  if (node.value === '__own')
    return groups.value.personal
  if (node.value === '__pending')
    return groups.value.unassigned
  const key = projectGroupKeyFromNode(node.value)
  if (key) {
    return groups.value.project.filter(inv => projectGroupKey(inv) === key)
  }
  return allRows.value
})

const rows = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  if (!kw)
    return nodeRows.value
  return nodeRows.value.filter(inv =>
    [inv.invoiceNumber, inv.seller, inv.buyer, inv.projectName, inv.remark]
      .some(v => v && v.toLowerCase().includes(kw)),
  )
})

async function openImport() {
  try {
    await openImportTab({ entity: 'invoice' })
  }
  catch (cause) {
    error(`导入打开失败：${toErrorMessage(cause)}`)
  }
}

const columnFilters = shallowRef<Record<string, readonly unknown[]>>({})
const tableFilteredRows = computed(() => {
  const activeFilters = Object.entries(columnFilters.value)
    .filter(([, values]) => values.length > 0)
  if (!activeFilters.length)
    return rows.value
  return rows.value.filter((row) => {
    const values = row as unknown as Record<string, unknown>
    return activeFilters.every(([field, filters]) => filters.includes(values[field]))
  })
})

const printableRows = computed(() => tableFilteredRows.value.filter(canCheck))

function openExportPreview() {
  if (!tableFilteredRows.value.length) {
    warning('当前筛选下没有可导出的发票')
    return
  }
  exportPreviewRows.value = invoiceLedgerRows(tableFilteredRows.value)
  exportPreviewFileName.value = `发票台账_${toLocalDateInputValue()}.xlsx`
  exportPreviewOpen.value = true
}

function openPrint() {
  if (!printableRows.value.length) {
    warning('当前筛选下没有可打印的扫描发票')
    return
  }
  pendingPrint.value = null
  printSelectedId.value = printableRows.value[0]?.id ?? null
  printMode.value = true
}

async function handlePrint(payload: InvoicePrintRequest) {
  if (pendingPrint.value)
    return
  pendingPrint.value = payload
  await nextTick()
  try {
    window.print()
  }
  catch {
    pendingPrint.value = null
    warning('系统打印窗口打开失败，请检查打印权限后重试')
  }
}

function cancelPrint() {
  pendingPrint.value = null
}

async function confirmPrint() {
  const payload = pendingPrint.value
  if (!payload)
    return
  pendingPrint.value = null
  try {
    const updated = await store.recordPrinted(payload.ids, payload.rotations)
    success(`已记录 ${updated} 张发票的打印次数`)
  }
  catch {
    warning('打印记录未保存：所选发票已发生变化，请刷新后重试')
  }
}

function leavePrint() {
  pendingPrint.value = null
  printMode.value = false
}

async function confirmExport(styleConfig: InvoiceXlsxStyleConfig) {
  if (exportSaving.value || !exportPreviewRows.value.length)
    return
  exportSaving.value = true
  try {
    await exportFile({
      data: createInvoiceLedgerXlsxFromRows(exportPreviewRows.value, styleConfig),
      defaultName: exportPreviewFileName.value,
      mimeType: INVOICE_XLSX_MIME,
    })
    exportPreviewOpen.value = false
  }
  catch (cause) {
    error(`导出失败：${toErrorMessage(cause)}`)
  }
  finally {
    exportSaving.value = false
  }
}

// ── 右表（KitTable，ADR 0009）：供应商 / 类型 / 来源列头筛选 ──
const columns = computed<KitTableColumn[]>(() => [
  { type: 'checkbox', title: '' },
  { field: 'invoiceNumber', title: '单据编号', width: 120, slot: 'number' },
  { field: 'invoiceDate', title: '开票日期', type: 'date', width: 104 },
  { field: 'seller', title: '供应商', minWidth: 180, filterable: true, slot: 'seller' },
  { field: 'totalAmount', title: '价税合计', type: 'money', width: 120 },
  { field: 'invoiceType', title: '类型', width: 110, filterable: true, slot: 'type' },
  {
    field: 'source',
    title: '来源',
    width: 78,
    slot: 'source',
    filterable: [{ label: '扫描', value: 'scan' }, { label: '导入', value: 'excel' }],
  },
  { field: 'projectName', title: '归属', minWidth: 130, slot: 'owner' },
  { field: 'printCount', title: '打印', width: 92, slot: 'print' },
  { title: '操作', type: 'action', width: 118 },
])

function onLedgerFilterChange(payload: { filters: { field: string, values: unknown[] }[] }) {
  columnFilters.value = Object.fromEntries(payload.filters.map(filter => [filter.field, filter.values]))
}

/** excel 导入票无扫描件：不可勾选（勾选服务于打印/导出原件） */
function canCheck(row: Invoice) {
  return row.source !== 'excel'
}

// ── 勾选浮出合计（#69：平时无常驻汇总）──
const checkedRows = shallowRef<Invoice[]>([])
const checkedTotal = computed(() => checkedRows.value.reduce((s, inv) => s + inv.totalAmount, 0))

const tableEl = useTemplateRef<{ clearCheckbox: () => void, clearFilter: () => Promise<void> | void }>('tableEl')

// 切树节点 / 搜索 / 切视图都会改变行集，勾选集随之失效
watch([node, searchText, view], () => {
  tableEl.value?.clearCheckbox()
  columnFilters.value = {}
  void tableEl.value?.clearFilter()
  checkedRows.value = []
})

// ── 行操作 ──
function tail8(no: string) {
  return no ? no.slice(-8) : '—'
}

function openEdit(inv: Invoice) {
  router.push(`/finance/invoice/${inv.id}`)
}

async function del(inv: Invoice) {
  const ok = await confirm({
    variant: 'simple',
    title: '删除发票',
    message: `确认删除发票「${tail8(inv.invoiceNumber)}」？删除后可在 10 秒内撤回。`,
    confirmLabel: '删除',
  })
  if (!ok)
    return
  const logId = await store.remove(inv.id)
  if (!logId) {
    error('删除失败：发票不存在或已删除')
    return
  }
  checkedRows.value = checkedRows.value.filter(r => r.id !== inv.id)
  undoToast(`已删除发票「${tail8(inv.invoiceNumber)}」`, () => store.undo(logId))
}

function typeShort(t: string) {
  return (t || '').replace('增值税', '').replace('发票', '') || '—'
}

// 销方公司名 → 在册分供方 id（含别名，照设计稿 findIdByName）；
// 非在册销方查无 id → EntityLink 自动退化纯文本
const supplierIdByName = computed(() => {
  const map = new Map<string, string>()
  for (const s of supplierStore.list) {
    map.set(s.name, s.id)
    for (const alias of s.aliases)
      map.set(alias, s.id)
  }
  return map
})

// ── 归档（「待归档」行入口，自识别工作台迁入 #69）──
const OWNER_KIND_LABEL = { project: '归属项目', personal: '个人开支' } as const

/** 归档：弹出归属选择表单，校验交给 store.archiveInvoice（缺归属/项目归属未选具体项目均拒绝）。 */
async function archiveFlow(inv: Invoice) {
  const values = await formModal({
    title: '归档发票',
    subtitle: '归档需指定归属（项目 / 个人开支），归档后计入台账统计（DATABASE.md §4.2）。',
    fields: [
      { key: 'ownerKindLabel', label: '归属', type: 'select', options: Object.values(OWNER_KIND_LABEL), value: OWNER_KIND_LABEL.project, required: true },
      { key: 'projectName', label: '对应项目（归属项目时必选）', type: 'select', options: projectStore.list.map(p => p.name), value: inv.projectName || '' },
    ],
    saveText: '归档',
  })
  if (!values)
    return
  const ownerKind = values.ownerKindLabel === OWNER_KIND_LABEL.personal ? 'personal' : 'project'
  const project = ownerKind === 'project' ? projectStore.list.find(p => p.name === String(values.projectName)) : undefined
  const result = await store.archiveInvoice(inv.id, ownerKind, project?.id ?? null, project?.name)
  if (!result.ok) {
    warning(result.reason ?? '归档失败')
    return
  }
  success('已归档，计入台账')
}

onMounted(() => {
  if (!store.list.length)
    store.load()
  if (!projectStore.list.length)
    projectStore.load()
  if (!supplierStore.list.length)
    supplierStore.load()
})
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <InvoicePrintLayout
      v-if="printMode"
      v-model:selected-id="printSelectedId"
      :invoices="printableRows"
      :print-confirmation="pendingPrint"
      full-page
      @print="handlePrint"
      @confirm-print="confirmPrint"
      @cancel-print="cancelPrint"
      @back="leavePrint"
    />

    <template v-else>
      <InvoiceLedgerToolbar
        v-model:search="searchText"
        v-model:view="view"
        :total="allRows.length"
        :visible="tableFilteredRows.length"
        @import="openImport"
        @print="openPrint"
        @export="openExportPreview"
      />

      <!-- 左树右表 -->
      <div class="grid grid-cols-1 items-start gap-3.5 md:grid-cols-[220px_minmax(0,1fr)]">
        <TreeNav v-model="node" title="按归属" :items="treeItems" />

        <div class="min-w-0 flex flex-col">
          <!-- 表格视图 -->
          <KitTable
            v-if="view === 'table'"
            ref="tableEl"
            :columns="columns"
            :data="rows"
            :loading="store.loading"
            :check-method="canCheck"
            empty="该归属下暂无发票。"
            @checkbox-change="(list: Invoice[]) => checkedRows = list"
            @filter-change="onLedgerFilterChange"
          >
            <template #number="{ row }">
              <button
                type="button"
                class="border-0 bg-transparent p-0 font-mono text-13px font-700 text-brand cursor-pointer hover:text-brand-deep"
                title="编辑（开页签）"
                @click="openEdit(row)"
              >
                {{ tail8(row.invoiceNumber) }}
              </button>
            </template>
            <template #type="{ row }">
              <span class="text-ink-soft">{{ typeShort(row.invoiceType) }}</span>
            </template>
            <template #source="{ row }">
              <span :class="row.source === 'scan' ? 'chip-brand' : 'chip bg-surface-3 text-ink-soft'">
                {{ row.source === 'scan' ? '扫描' : '导入' }}
              </span>
            </template>
            <template #seller="{ row }">
              <EntityLink :id="supplierIdByName.get(row.seller)" type="supplier" :label="row.seller" />
            </template>
            <template #owner="{ row }">
              <span v-if="row.ownerKind === 'personal'" class="text-brand-deep">个人开支</span>
              <EntityLink v-else-if="row.projectName" :id="row.projectId" type="project" :label="row.projectName" />
              <span v-else class="chip-warn">待归档</span>
            </template>
            <template #print="{ row }">
              <span v-if="row.printCount > 0" class="chip-ok">{{ row.printCount }} 次</span>
              <span v-else class="chip-warn">未打印</span>
            </template>
            <template #action="{ row }">
              <div class="flex items-center gap-1">
                <button v-if="row.accountStatus === 'none'" class="icon-btn" title="归档" @click="archiveFlow(row)">
                  <span class="i-lucide-archive text-14px" aria-hidden="true" />
                </button>
                <button class="icon-btn" title="编辑（开页签）" @click="openEdit(row)">
                  <span class="i-lucide-square-pen text-14px" aria-hidden="true" />
                </button>
                <button class="icon-btn-danger" title="删除" @click="del(row)">
                  <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
                </button>
              </div>
            </template>
          </KitTable>

          <!-- 卡片视图（发票预览大图，快速删除） -->
          <div v-else class="panel p-3.5">
            <div class="grid grid-cols-1 gap-3 lg:grid-cols-3 sm:grid-cols-2">
              <div
                v-for="inv in rows"
                :key="inv.id"
                class="panel panel-hover flex flex-col overflow-hidden"
              >
                <div
                  class="grid cursor-pointer place-items-center border-b border-line bg-surface-2 p-2.5"
                  @click="openEdit(inv)"
                >
                  <div class="w-4/5">
                    <InvoicePreviewSvg :invoice="inv" />
                  </div>
                </div>
                <div class="flex flex-col gap-1.5 p-3">
                  <div class="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      class="border-0 bg-transparent p-0 font-mono text-14px font-800 text-brand cursor-pointer"
                      @click="openEdit(inv)"
                    >
                      {{ tail8(inv.invoiceNumber) }}
                    </button>
                    <span class="font-mono text-15px font-800">{{ yuan(inv.totalAmount) }}</span>
                  </div>
                  <div class="truncate text-12px text-ink-soft">
                    {{ inv.seller }}
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span v-if="inv.ownerKind === 'personal'" class="chip-brand">个人开支</span>
                    <span v-else-if="inv.projectName" class="chip bg-surface-3 text-ink-soft">{{ inv.projectName }}</span>
                    <span v-else class="chip-warn">待归档</span>
                    <span class="font-mono text-11px text-ink-faint">{{ inv.invoiceDate }}</span>
                  </div>
                  <div class="mt-0.5 flex items-center gap-1.5">
                    <button class="btn-secondary text-12px" @click="openEdit(inv)">
                      <span class="i-lucide-square-pen mr-1 text-12px" aria-hidden="true" />编辑
                    </button>
                    <button class="icon-btn-danger" title="删除" @click="del(inv)">
                      <span class="i-lucide-trash-2 text-14px" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
              <div v-if="rows.length === 0" class="col-span-full py-8 text-center text-ink-soft">
                该归属下暂无发票。
              </div>
            </div>
          </div>

          <!-- 底部：勾选才浮出合计（无常驻汇总） -->
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2.5 border border-line rounded-[var(--radius-card)] bg-surface-2 px-4 py-2.5 text-13px text-ink-soft shadow-[var(--shadow-card)]">
            <span v-if="checkedRows.length > 0" class="rounded-full bg-brand-soft px-2.5 py-0.5 text-brand-deep">
              已选 <b class="font-mono">{{ checkedRows.length }}</b> 张 · 合计 <b class="font-mono">{{ yuan(checkedTotal) }}</b>
            </span>
            <span v-else class="text-ink-faint">勾选发票后显示合计</span>
            <span class="text-12px">共 {{ rows.length }} 条</span>
          </div>
        </div>
      </div>

      <InvoiceExportPreview
        v-model:open="exportPreviewOpen"
        :rows="exportPreviewRows"
        :total-amount="exportPreviewTotal"
        :file-name="exportPreviewFileName"
        :saving="exportSaving"
        @confirm="confirmExport"
      />
    </template>
  </div>
</template>
