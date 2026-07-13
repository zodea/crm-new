<script setup lang="ts">
import type { InvoiceDocStatus } from '~/lib/invoice/status'
import type { Invoice } from '~/stores/invoice'
import { isAllGreen, resolveAttribution } from '~/lib/invoice/batch-pass'
import { isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'
import { invoiceDocStatus } from '~/lib/invoice/status'
import { formatMoney } from '~/lib/util/money'

const store = useInvoiceStore()
const projectStore = useProjectStore()
const { success, warning, info, undoToast, confirm, promise } = useKitUI()

// 台账已拆独立页 /finance/ledger（#69）：本页收敛为识别工作台两 Tab（文档管理 / 校对与排版）
const activeTab = ref<'docs' | 'review'>('docs')
const searchText = ref('')
const selectedId = ref<string | null>(null)

// 归属：项目 / 个人开支 单选中文文案 ↔ ownerKind 的映射（手动录入表单 select 用）
const OWNER_KIND_LABEL = { project: '归属项目', personal: '个人开支' } as const
function labelToOwnerKind(label: string): 'project' | 'personal' {
  return label === OWNER_KIND_LABEL.personal ? 'personal' : 'project'
}
/** 手动录入表单专用的第三态：不属于业务归属枚举，代表"这次先不归档"，故不放进 OWNER_KIND_LABEL。 */
const NO_ATTRIBUTION_LABEL = '暂不归属'

/** 按项目名称查具体项目（归档写入用规范名，而非发票原始 OCR/自由文本，避免 project_id/project_name 各指不同项目）。 */
function findProjectByName(name: string) {
  return projectStore.list.find(p => p.name === name)
}

// 归档弹窗流程已随台账迁至 /finance/ledger（#69）；工作台归档走 archiveSelected（自动解析归属）

// 新增弹窗
const showAddDialog = ref(false)
const addForm = reactive({
  invoiceType: '增值税专用发票',
  invoiceNumber: '',
  invoiceDate: '',
  buyer: '广州市瑞航建筑工程有限公司',
  seller: '',
  amount: 0,
  taxAmount: 0,
  totalAmount: 0,
  taxRate: '13%',
  remark: '',
  projectName: '',
  source: 'excel' as const,
  ownerKindLabel: NO_ATTRIBUTION_LABEL,
})

function resetAddForm() {
  addForm.invoiceType = '增值税专用发票'
  addForm.invoiceNumber = ''
  addForm.invoiceDate = ''
  addForm.buyer = '广州市瑞航建筑工程有限公司'
  addForm.seller = ''
  addForm.amount = 0
  addForm.taxAmount = 0
  addForm.totalAmount = 0
  addForm.taxRate = '13%'
  addForm.remark = ''
  addForm.projectName = ''
  addForm.ownerKindLabel = NO_ATTRIBUTION_LABEL
}

async function handleAdd() {
  if (!addForm.invoiceNumber && !addForm.seller) {
    warning('请至少填写发票号码或供应商')
    return
  }
  // 手动录入内容已确定，直接落「已确认」态；选了归属则立即归档，否则留到台账页按需归档。
  const { ownerKindLabel, ...invoiceData } = addForm
  const id = await store.add({
    ...invoiceData,
    ocrStatus: 'done',
    reviewStatus: 'reviewed',
    confirmedAt: new Date().toISOString(),
  })
  if (ownerKindLabel === NO_ATTRIBUTION_LABEL) {
    success('发票已添加，待归档后计入台账')
  }
  else {
    const ownerKind = labelToOwnerKind(ownerKindLabel)
    const project = ownerKind === 'project' ? findProjectByName(addForm.projectName) : undefined
    const result = await store.archiveInvoice(id, ownerKind, project?.id ?? null, project?.name)
    if (result.ok)
      success('发票已添加并归档，计入台账')
    else
      warning(`发票已添加，但归档失败：${result.reason}`)
  }
  showAddDialog.value = false
  resetAddForm()
}

// 删除确认
const showDeleteConfirm = ref(false)
const deleteTargetId = ref<string | null>(null)
const deleteTargetName = ref('')

function askDelete(inv: Invoice) {
  deleteTargetId.value = inv.id
  deleteTargetName.value = inv.invoiceNumber || inv.fileName || inv.id
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (!deleteTargetId.value)
    return
  await store.remove(deleteTargetId.value)
  success('已删除')
  showDeleteConfirm.value = false
  if (selectedId.value === deleteTargetId.value)
    selectedId.value = null
  deleteTargetId.value = null
}

// 统计
const tabCounts = computed(() => ({
  docs: store.documents.length,
  review: store.pendingReview.length,
}))

// 状态判定统一走 invoiceDocStatus(单一权威派生,与工作台左栏同优先级),本页只做文案/样式映射
function docStatus(inv: Invoice): InvoiceDocStatus {
  return invoiceDocStatus(inv, store.recognitionProgress[inv.id] != null)
}

const docStats = computed(() => {
  let pending = 0
  let done = 0
  let duplicate = 0
  for (const d of store.documents) {
    const st = docStatus(d)
    if (st === 'pending' || st === 'failed' || st === 'recognizing')
      pending++
    if (st === 'unreviewed' || st === 'reviewed')
      done++
    if (st === 'duplicate')
      duplicate++
  }
  return { pending, done, duplicate }
})

const DOC_STATUS_LABEL: Record<InvoiceDocStatus, string> = {
  recognizing: '识别中',
  pending: '待识别',
  failed: '识别失败',
  duplicate: '重复已排除',
  unreviewed: '识别完成',
  reviewed: '识别完成',
}
const DOC_STATUS_CLASS: Record<InvoiceDocStatus, string> = {
  recognizing: 'text-brand font-600',
  pending: 'cell--status-warn',
  failed: 'cell--status-danger',
  duplicate: 'cell--status-danger',
  unreviewed: 'cell--status-ok',
  reviewed: 'cell--status-ok',
}

function statusLabel(inv: Invoice): string {
  return DOC_STATUS_LABEL[docStatus(inv)]
}
function statusClass(inv: Invoice): string {
  return DOC_STATUS_CLASS[docStatus(inv)]
}

const docsFiltered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  let items = store.documents
  if (q) {
    items = items.filter(inv =>
      inv.fileName.toLowerCase().includes(q)
      || inv.seller.toLowerCase().includes(q)
      || inv.buyer.toLowerCase().includes(q),
    )
  }
  return items
})

function selectForReview(inv: Invoice) {
  selectedId.value = inv.id
  activeTab.value = 'review'
}

/** 右栏当前选中票（单点求值：模板 5 处引用不再各自 O(n) byId 扫描 + `!` 断言）。 */
const selectedInvoice = computed(() =>
  selectedId.value ? store.byId(selectedId.value) : undefined,
)

async function confirmSelected() {
  if (!selectedId.value)
    return
  const result = await store.confirmInvoice(selectedId.value)
  if (!result.ok) {
    warning(result.reason ?? '确认失败')
    return
  }
  success('已确认，可归档或在台账页归档')
}

/**
 * 工作台单票归档(#63)：归属已在校对表单内联收集（对应项目/个人开支，缺归属时按钮禁用到不了这里），
 * 直接按解析结果归档，不再弹归属选择框（台账页的归档仍走 archiveInvoiceFlow 弹窗）。
 */
async function archiveSelected() {
  if (!selectedId.value)
    return
  const inv = store.byId(selectedId.value)
  if (!inv)
    return
  const attribution = resolveAttribution(inv, findProjectByName)
  if (!attribution) {
    warning('缺归属：填写对应项目或选个人开支后方可归档')
    return
  }
  const result = await store.archiveInvoice(
    inv.id,
    attribution.ownerKind,
    attribution.ownerKind === 'project' ? attribution.projectId : null,
    attribution.ownerKind === 'project' ? attribution.projectName : undefined,
  )
  if (!result.ok) {
    warning(result.reason ?? '归档失败')
    return
  }
  success('已归档，计入台账')
  // 归档成功即离开工作台：清掉选中，不给已归档票留下残留的操作入口
  selectedId.value = null
}

// ── #60 上传双入口（按钮 useFileDialog + 全页拖拽 useDropZone）→ 桩识别队列 ──

const pageRef = useTemplateRef<HTMLElement>('pageRef')

// reset: true = 每次打开自动清空已选文件，允许重复选择同一文件
const { open: openFilePicker, onChange: onFilesPicked } = useFileDialog({
  multiple: true,
  accept: RECOGNIZABLE_FILE_ACCEPT,
  reset: true,
})
onFilesPicked(files => handleUpload(files))

/** 识别过程走 process 道 promise toast（AGENTS.md 双泳道：上传/识别等过程提示），失败张数如实提示。 */
async function runRecognition(run: Promise<{ done: number, failed: number }>, label: string) {
  const r = await promise(run, {
    loading: `${label}…`,
    success: ({ done }) => `已识别 ${done} 张`,
    error: () => '识别过程出错',
  })
  if (r.failed > 0)
    warning(`${r.failed} 张未完成识别（已归档/识别中/引擎失败），可稍后重试`)
}

async function handleUpload(files: File[] | FileList | null) {
  const picked = Array.from(files ?? []).filter(f => isRecognizableFile(f.name))
  if (!picked.length) {
    warning('请选择 PDF / 图片文件')
    return
  }
  activeTab.value = 'review'
  // 先建行并立刻选中第一张（识别进度就地可见）；识别完成后不再回头改选中，
  // 避免用户批量期间点开别的票校对时被抢走上下文
  const ids = await store.uploadInvoices(picked.map(f => ({ name: f.name, size: f.size })))
  selectedId.value = ids[0]!
  await runRecognition(store.recognizeMany(ids), `识别 ${ids.length} 张上传发票`)
}

// 全页拖拽（VueUse useDropZone；isOverDropZone 驱动虚线遮罩）
const { isOverDropZone } = useDropZone(pageRef, {
  onDrop: files => handleUpload(files),
})

// ── 识别队列状态 ──

const recognizing = computed(() => Object.keys(store.recognitionProgress).length > 0)
// 与 store.recognizeAllPending 共用同一待识别池（唯一谓词源），按钮计数与实际处理集不漂移
const pendingCount = computed(() => store.pendingRecognition.length)

async function handleBatchRecognize() {
  const ids = store.pendingRecognition.map(inv => inv.id)
  if (!ids.length) {
    info('没有待识别的发票')
    return
  }
  await runRecognition(store.recognizeMany(ids), `批量识别 ${ids.length} 张`)
}

async function handleRerecognize() {
  if (!selectedId.value)
    return
  const ok = await promise(store.startRecognition(selectedId.value), {
    loading: '重新识别中…',
    success: '识别完成，请校对',
    error: () => '识别失败',
  })
  if (!ok)
    warning('无法重新识别：该票已归档或正在识别中')
}

// ── 批量通过(#63)：全绿票(建议通过池)一次放行——有归属的确认+归档,缺归属的排除并列清单 ──

const batchPassing = ref(false)

async function handleBatchPass() {
  if (batchPassing.value || !store.suggestPass.length)
    return
  batchPassing.value = true
  try {
    const r = await promise(store.batchPass(), {
      loading: `批量通过 ${store.suggestPass.length} 张…`,
      success: ({ archived }) => `已通过并归档 ${archived} 张`,
      error: () => '批量通过出错',
    })
    if (r.excluded.length) {
      await confirm({
        title: `已排除 ${r.excluded.length} 张（缺归属）`,
        message: `${r.excluded.map(e => `·「${e.label}」— ${e.reason}`).join('\n')}\n\n补齐对应项目或选个人开支后可再次批量通过。`,
        confirmLabel: '知道了',
        cancelLabel: '关闭',
      })
    }
    // 选中票若在本轮被归档,清掉选中(已归档票不留工作台操作入口)
    const sel = selectedId.value ? store.byId(selectedId.value) : undefined
    if (sel?.accountStatus === 'archived')
      selectedId.value = null
  }
  finally {
    batchPassing.value = false
  }
}

// 废弃 = 软删除 + 10 秒 undoToast 撤回（#60 验收④）；已归档票不可废弃（已计入台账，删除走台账页确认弹窗）
async function handleDiscard() {
  if (!selectedId.value)
    return
  const inv = store.byId(selectedId.value)
  if (!inv)
    return
  if (inv.accountStatus === 'archived') {
    warning('已归档发票不可在工作台废弃，请到台账页删除')
    return
  }
  const logId = await store.remove(inv.id)
  if (!logId) {
    warning('废弃失败：发票不存在或已删除')
    return
  }
  selectedId.value = null
  undoToast(`已废弃「${inv.invoiceNumber || inv.fileName || inv.id}」`, () => store.undo(logId))
}

// 工作台左栏（单行化收窄）：全部未归档扫描件——含待识别/识别中/待校对/已校对/重复，
// 上传直落此列表原地显示「识别中 N%」；已归档的票流出工作台（进台账）。
// 状态判定统一走 invoiceDocStatus，此处只映射工作台文案/chip 样式，每行每轮只求值一次。
const WORKSPACE_STATUS_CLS: Record<InvoiceDocStatus, string> = {
  recognizing: 'text-brand font-600',
  pending: 'chip-warn',
  failed: 'chip-danger',
  duplicate: 'chip-danger',
  unreviewed: 'chip-warn',
  reviewed: 'chip-ok',
}
const WORKSPACE_STATUS_LABEL: Record<Exclude<InvoiceDocStatus, 'recognizing'>, string> = {
  pending: '待识别',
  failed: '识别失败',
  duplicate: '重复',
  unreviewed: '待校对',
  reviewed: '已校对',
}
const workspaceRows = computed(() =>
  store.documents
    .filter(inv => inv.accountStatus === 'none')
    .map((inv) => {
      const progress = store.recognitionProgress[inv.id]
      const status = invoiceDocStatus(inv, progress != null)
      // #63:全绿待校对票标「建议通过」(只标记不自动归档,人工点批量通过放行)
      if (status === 'unreviewed' && isAllGreen(inv.fieldConfidence))
        return { inv, label: '建议通过', cls: 'chip-ok' }
      return {
        inv,
        label: status === 'recognizing' ? `识别中 ${progress}%` : WORKSPACE_STATUS_LABEL[status],
        cls: WORKSPACE_STATUS_CLS[status],
      }
    }),
)

onMounted(() => {
  store.load()
  projectStore.load()
})
</script>

<template>
  <div ref="pageRef" class="relative">
    <!-- 全页拖拽虚线遮罩（#60：拖入即上传进识别队列；「+ 上传发票」走 useFileDialog 无需宿主元素） -->
    <div
      v-if="isOverDropZone"
      class="absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-brand bg-brand-soft/40 pointer-events-none"
    >
      <div class="text-center">
        <span class="i-lucide-file-down text-32px text-brand block mx-auto mb-2" />
        <p class="text-14px font-700 text-brand-deep">
          松开上传发票，自动进入识别队列
        </p>
      </div>
    </div>

    <!-- Tab 栏 -->
    <div class="flex items-center border-b border-line mb-4">
      <button
        class="content-tab"
        :class="activeTab === 'docs' ? 'content-tab-active' : ''"
        @click="activeTab = 'docs'"
      >
        文档管理 {{ tabCounts.docs }}
      </button>
      <button
        class="content-tab"
        :class="activeTab === 'review' ? 'content-tab-active' : ''"
        @click="activeTab = 'review'"
      >
        校对与排版 {{ tabCounts.review }}
      </button>
      <!-- 台账已拆独立页（#69）：这里只留跳转入口 -->
      <NuxtLink to="/finance/ledger" class="content-tab inline-flex items-center gap-1">
        发票台账
        <span class="i-lucide-arrow-up-right h-[12px] w-[12px]" aria-hidden="true" />
      </NuxtLink>
      <div class="flex-1" />
      <button class="btn-secondary mr-2" @click="showAddDialog = true">
        <span class="i-lucide-plus text-13px mr-1" /> 手动录入
      </button>
      <button
        class="btn-primary mr-2"
        :disabled="recognizing || pendingCount === 0"
        :title="pendingCount === 0 ? '没有待识别的发票' : `识别 ${pendingCount} 张待识别发票`"
        @click="handleBatchRecognize"
      >
        <span class="text-13px mr-1" :class="recognizing ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-scan-text'" />
        批量识别{{ pendingCount > 0 ? ` ${pendingCount}` : '' }}
      </button>
      <button
        class="btn-primary mr-1"
        :disabled="batchPassing || store.suggestPass.length === 0"
        :title="store.suggestPass.length === 0 ? '没有全绿(建议通过)的发票' : `放行 ${store.suggestPass.length} 张建议通过发票(有归属的确认+归档,缺归属的排除并列出)`"
        @click="handleBatchPass"
      >
        <span class="text-13px mr-1" :class="batchPassing ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-check-check'" />
        批量通过{{ store.suggestPass.length > 0 ? ` ${store.suggestPass.length}` : '' }}
      </button>
    </div>

    <!-- ═══ Tab 1: 文档管理 ═══ -->
    <div v-if="activeTab === 'docs'">
      <!-- 上传区（点击选文件；全页任意位置也可直接拖入） -->
      <div class="upload-zone mb-4 py-8 cursor-pointer" @click="openFilePicker()">
        <span class="i-lucide-upload text-24px mb-2 block mx-auto text-brand" />
        <p class="text-13px font-600">
          点击选择 或 拖拽 PDF / 图片到此处上传
        </p>
        <p class="text-11px text-ink-faint mt-1">
          上传后自动进入识别队列
        </p>
      </div>

      <!-- 统计卡片 -->
      <div class="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="全部文档" :value="store.documents.length" icon="i-lucide-file-text" color="brand" />
        <StatCard
          label="待识别"
          :value="docStats.pending"
          icon="i-lucide-clock" color="warn"
        />
        <StatCard
          label="识别完成"
          :value="docStats.done"
          icon="i-lucide-circle-check" color="ok"
        />
        <StatCard
          label="重复/排除"
          :value="docStats.duplicate"
          icon="i-lucide-copy-x" color="danger"
        />
      </div>

      <!-- 搜索 -->
      <div class="mb-3">
        <input
          v-model="searchText"
          class="field-input w-64"
          placeholder="搜索文件名、公司…"
        >
      </div>

      <!-- 文档表格 -->
      <div class="border border-line">
        <vxe-table
          :data="docsFiltered"
          :loading="store.loading"
          border
          show-overflow
          height="auto"
          :row-config="{ isHover: true, keyField: 'id' }"
        >
          <vxe-column type="seq" title="#" width="52" />
          <vxe-column field="fileName" title="文件名" min-width="200">
            <template #default="{ row }">
              <span class="font-700">{{ row.fileName || '—' }}</span>
            </template>
          </vxe-column>
          <vxe-column field="invoiceType" title="类型" width="130">
            <template #default="{ row }">
              <span class="text-ink-soft">{{ row.invoiceType || '—' }}</span>
            </template>
          </vxe-column>
          <vxe-column field="seller" title="供应商" min-width="160">
            <template #default="{ row }">
              <span class="text-ink-soft">{{ row.seller || '—' }}</span>
            </template>
          </vxe-column>
          <vxe-column field="totalAmount" title="价税合计" width="120">
            <template #default="{ row }">
              <span class="font-mono font-700 block text-right">
                {{ row.totalAmount ? formatMoney(row.totalAmount) : '—' }}
              </span>
            </template>
          </vxe-column>
          <vxe-column title="状态" width="110">
            <template #default="{ row }">
              <span :class="statusClass(row)">{{ statusLabel(row) }}</span>
            </template>
          </vxe-column>
          <vxe-column title="操作" width="90" fixed="right">
            <template #default="{ row }">
              <div class="flex items-center gap-1">
                <button
                  v-if="row.ocrStatus === 'done' && row.dupStatus === 'normal'"
                  class="icon-btn" title="校对"
                  @click="selectForReview(row)"
                >
                  <span class="i-lucide-file-search text-14px" />
                </button>
                <button class="icon-btn-danger" title="删除" @click="askDelete(row)">
                  <span class="i-lucide-trash-2 text-14px" />
                </button>
              </div>
            </template>
          </vxe-column>
        </vxe-table>
      </div>
    </div>

    <!-- ═══ Tab 2: 校对与排版（#60 字段校对模式：左列表 18% 单行化 / 中原图 40% / 右字段表 42%） ═══ -->
    <div v-else-if="activeTab === 'review'">
      <div class="flex gap-3" style="height: calc(100vh - 240px); min-height: 560px">
        <!-- 左栏 — 发票列表（单行化收窄；上传直落此列表原地显示「识别中 N%」） -->
        <div class="basis-[18%] min-w-44 shrink-0 border border-line bg-panel overflow-y-auto">
          <div class="px-2.5 py-2 border-b border-line flex items-center gap-1.5">
            <button class="btn-primary text-11px px-2 py-1 flex-1" @click="openFilePicker()">
              <span class="i-lucide-plus text-11px mr-0.5" /> 上传发票
            </button>
          </div>
          <div class="px-2.5 py-1.5 border-b border-line text-11px text-ink-soft">
            本批次 {{ workspaceRows.length }} 张 · 待校对 {{ store.pendingReview.length }}
          </div>
          <div
            v-for="{ inv, label, cls } in workspaceRows"
            :key="inv.id"
            class="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-line cursor-pointer transition-colors"
            :class="selectedId === inv.id ? 'bg-brand-soft' : 'hover:bg-surface-3'"
            @click="selectedId = inv.id"
          >
            <span class="text-11px font-700 truncate flex-1 min-w-0" :title="inv.fileName || inv.invoiceNumber">
              {{ inv.invoiceNumber ? `…${inv.invoiceNumber.slice(-8)}` : (inv.fileName || '—') }}
            </span>
            <span class="text-10px shrink-0" :class="cls">
              {{ label }}
            </span>
          </div>
          <div v-if="!workspaceRows.length" class="p-4 text-center text-ink-faint text-12px">
            上传发票开始识别
          </div>
        </div>

        <!-- 中栏 — 原图（放大） -->
        <div class="basis-[40%] min-w-0 border border-line bg-surface-sink overflow-y-auto p-4">
          <div class="text-12px text-ink-soft mb-3">
            发票原图
          </div>
          <div class="bg-panel border border-line mx-auto p-4" style="aspect-ratio: 1/1.4142; max-width: 560px">
            <div v-if="selectedInvoice" class="h-full flex items-center justify-center">
              <div class="text-center">
                <div class="w-28 h-40 bg-surface-2 rounded-[3px] mx-auto mb-2 flex items-center justify-center border-2 border-brand">
                  <span class="text-32px font-800 text-ink-faint">票</span>
                </div>
                <span class="text-11px text-ink-soft block">{{ selectedInvoice.fileName || '—' }}</span>
                <span class="text-11px text-ink-faint font-mono">{{ selectedInvoice.invoiceNumber?.slice(-8) || '' }}</span>
              </div>
            </div>
            <div v-else class="h-full flex items-center justify-center text-ink-faint text-13px">
              从左侧列表选择发票
            </div>
          </div>
        </div>

        <!-- 右栏 — 识别结果校对（字段表） -->
        <div class="basis-[42%] min-w-0 border border-line bg-panel overflow-y-auto">
          <div class="px-3 py-2 border-b border-line text-12px font-700 text-ink">
            识别结果提取
          </div>
          <!-- 进度优先于表单：重新识别时(ocrStatus 仍是 done)也要显示识别中而非旧字段 -->
          <template v-if="selectedInvoice">
            <div v-if="store.recognitionProgress[selectedInvoice.id] != null" class="p-6 text-center text-12px">
              <span class="i-lucide-loader-circle animate-spin text-20px text-brand block mx-auto mb-2" />
              <span class="text-brand font-600">识别中 {{ store.recognitionProgress[selectedInvoice.id] }}%</span>
            </div>
            <div v-else-if="selectedInvoice.ocrStatus === 'done'" class="p-3">
              <InvoiceReviewForm
                :invoice="selectedInvoice"
                @confirm="confirmSelected"
                @archive="archiveSelected"
                @discard="handleDiscard"
                @rerecognize="handleRerecognize"
              />
            </div>
            <div v-else class="p-6 text-center text-12px">
              <span class="text-ink-faint">待识别——点击顶部「批量识别」开始</span>
            </div>
          </template>
          <div v-else class="p-4 text-center text-ink-faint text-12px">
            选择一张发票开始校对
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ 删除确认弹窗 ═══ -->
    <ConfirmDialog
      :open="showDeleteConfirm"
      title="删除发票"
      :message="`确认删除发票「${deleteTargetName}」？此操作不可撤回。`"
      confirm-label="删除"
      :danger="true"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false"
    />

    <!-- ═══ 新增发票弹窗 ═══ -->
    <FormDialog
      :open="showAddDialog"
      title="手动录入发票"
      save-label="添加"
      width="min(640px, 95vw)"
      @save="handleAdd"
      @cancel="showAddDialog = false"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">票据类型</label>
          <select v-model="addForm.invoiceType" class="field-input w-full">
            <option value="增值税专用发票">
              增值税专用发票
            </option>
            <option value="增值税普通发票">
              增值税普通发票
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">发票号码</label>
          <input v-model="addForm.invoiceNumber" class="field-input w-full font-mono" placeholder="发票号码">
        </div>
        <div>
          <label class="field-label">开票日期</label>
          <input v-model="addForm.invoiceDate" type="date" class="field-input w-full font-mono">
        </div>
        <div>
          <label class="field-label">税率</label>
          <select v-model="addForm.taxRate" class="field-input w-full">
            <option value="13%">
              13%
            </option>
            <option value="9%">
              9%
            </option>
            <option value="6%">
              6%
            </option>
            <option value="3%">
              3%
            </option>
            <option value="1%">
              1%
            </option>
            <option value="0%">
              0%
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">购买方</label>
          <input v-model="addForm.buyer" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">供应商（销方）</label>
          <input v-model="addForm.seller" class="field-input w-full" placeholder="供应商名称">
        </div>
        <div>
          <label class="field-label">不含税金额</label>
          <input v-model.number="addForm.amount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">税额</label>
          <input v-model.number="addForm.taxAmount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">价税合计</label>
          <input v-model.number="addForm.totalAmount" type="number" class="field-input w-full font-mono" step="0.01">
        </div>
        <div>
          <label class="field-label">对应项目</label>
          <input v-model="addForm.projectName" class="field-input w-full" placeholder="项目名称" list="invoice-project-names">
          <datalist id="invoice-project-names">
            <option v-for="p in projectStore.list" :key="p.id" :value="p.name" />
          </datalist>
        </div>
        <div>
          <label class="field-label">发票归属</label>
          <select v-model="addForm.ownerKindLabel" class="field-input w-full">
            <option value="暂不归属">
              暂不归属（先录入，台账页再归档）
            </option>
            <option :value="OWNER_KIND_LABEL.project">
              {{ OWNER_KIND_LABEL.project }}
            </option>
            <option :value="OWNER_KIND_LABEL.personal">
              {{ OWNER_KIND_LABEL.personal }}
            </option>
          </select>
        </div>
        <div class="col-span-2">
          <label class="field-label">票面备注</label>
          <input v-model="addForm.remark" class="field-input w-full" placeholder="备注信息">
        </div>
      </div>
    </FormDialog>
  </div>
</template>
