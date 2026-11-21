<script setup lang="ts">
import type { InvoicePrintRequest } from '~/lib/invoice/print-layout'
import type { RecognizedInvoiceFields } from '~/lib/invoice/recognize'
import type { InvoiceDocStatus } from '~/lib/invoice/status'
import type { Invoice } from '~/stores/invoice'
import { onBeforeRouteLeave } from 'vue-router'
import { useInvoiceRegionTarget } from '~/composables/useInvoiceRegionTarget'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { isAllGreen, resolveAttribution } from '~/lib/invoice/batch-pass'
import { INVOICE_RECOGNITION_FIELDS, invoiceRecognitionChanges, invoiceRecognitionMarks, invoiceRecognitionSaveMessage } from '~/lib/invoice/recognition-changes'
import { invoiceRegionFocus, invoiceRegionHighlights } from '~/lib/invoice/recognition-regions'
import { confidenceTier, isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'
import { invoiceDocStatus } from '~/lib/invoice/status'

const store = useInvoiceStore()
const projectStore = useProjectStore()
const { success, warning, info, undoToast, confirm, promise } = useKitUI()

// #60：单一校对工作台，上传、识别状态与字段校对在同一上下文完成。
const searchText = shallowRef('')
const workspaceFilter = shallowRef<string[]>([])
const selectedId = shallowRef<string | null>(null)
// 子模式的 tab 定义随工具栏走（内联在工具栏那一条里，不再独占一行）
const workspaceMode = shallowRef<'review' | 'print'>('review')
const activePane = shallowRef<'queue' | 'source' | 'review'>('queue')
const pendingPrint = shallowRef<InvoicePrintRequest | null>(null)
const paneLabels = computed(() => ({
  queue: '队列',
  source: workspaceMode.value === 'print' ? '排版' : '原件',
  review: '校对',
}))

// 窄屏切到打印排版时直接展示排版面板，避免用户在“字段校对 → 打印排版”后再次追着切面板。
watch(workspaceMode, (mode) => {
  if (mode === 'print')
    activePane.value = 'source'
})

/** 按项目名称查具体项目（归档写入用规范名，而非发票原始 OCR/自由文本，避免 project_id/project_name 各指不同项目）。 */
function findProjectByName(name: string) {
  return projectStore.list.find(p => p.name === name)
}

// 归档弹窗流程已随台账迁至 /finance/ledger（#69）；工作台归档走 archiveSelected（自动解析归属）

const showAddDialog = shallowRef(false)

/** 右栏当前选中票（单点求值：模板 5 处引用不再各自 O(n) byId 扫描 + `!` 断言）。 */
const selectedInvoice = computed(() =>
  selectedId.value ? store.byId(selectedId.value) : undefined,
)

// ── 重新识别草稿（用户 2026-10-13 确认）──
// 已识别票重新识别的结果只进当前表单，数据库保持识别前的值；保存/确认/归档前二次确认列出变动，
// 取消则草稿与高亮保留。切换选中、离开页面或关闭页签按离开保护确认放弃，不静默写入。
interface RecognitionDraft {
  id: string
  /** 识别前用户看到的值（工作台字段即时落库，即当时的库内值） */
  before: Invoice
  recognized: RecognizedInvoiceFields
  /** 草稿上的人工修改，保存时在识别写入之后以人工单独记一次 */
  edits: Partial<Invoice>
}
const draft = shallowRef<RecognitionDraft | null>(null)

const draftValues = computed<Invoice | null>(() => draft.value
  ? { ...draft.value.before, ...draft.value.recognized, reviewStatus: 'unreviewed', ...draft.value.edits }
  : null)
const draftChanges = computed(() => draft.value && draftValues.value
  ? invoiceRecognitionChanges(INVOICE_RECOGNITION_FIELDS, draft.value.before, draftValues.value)
  : [])
const draftMarks = computed(() => draft.value && draftValues.value
  ? invoiceRecognitionMarks(INVOICE_RECOGNITION_FIELDS, draft.value.before, { ...draft.value.before, ...draft.value.recognized }, draftValues.value)
  : {})
/** 右栏校对表单展示值：选中票有草稿时显示草稿 */
const draftSelected = computed(() => !!draft.value && draft.value.id === selectedInvoice.value?.id)

// 中栏原图：选中票的原文件仍在上传会话中时统一用预览器显示（可缩放、旋转，PDF 逐页）；不在会话中如实说明。
const selectedFile = computed(() => selectedId.value ? store.recognitionFile(selectedId.value) : undefined)
// 区域框（区域只在内存中，原文件失效即随之失效）：重新识别草稿常驻框出变动字段（比对）；
// 否则已识别票用最近写入的识别区域做点字段定位——聚焦/悬停字段时只框该字段，失焦撤回；
// 窄屏切到“原件”面板（失焦由切面板引起）时保留最近一次定位，切回“校对”后按新焦点更新。
const selectedRegions = computed(() => {
  const invoice = selectedInvoice.value
  return invoice && !draftSelected.value && invoice.ocrStatus === 'done' && selectedFile.value
    ? store.recognitionRegions(invoice.id)
    : undefined
})
// 只认“校对 → 原件”的分段切换：宽屏三栏不显示分段，activePane 仅随打印排版跳到原件，不应恢复已撤的框。
// 同步更新：分段在 mousedown 即切换，输入框随后才失焦，release 须已能看到切换结果。
const sourceFromReview = shallowRef(false)
watch(activePane, (pane, previous) => {
  sourceFromReview.value = pane === 'source' && previous === 'review'
}, { flush: 'sync' })
const regionTarget = useInvoiceRegionTarget({
  revealLast: () => sourceFromReview.value && !!selectedRegions.value && workspaceMode.value === 'review',
})
const draftRegions = computed(() => {
  const current = draft.value
  if (!current || !draftSelected.value || !selectedFile.value)
    return undefined
  const { groups, unlocated } = invoiceRegionHighlights(INVOICE_RECOGNITION_FIELDS, draftMarks.value, current.recognized.fieldRegions)
  return groups.length || unlocated.length ? { mode: 'compare' as const, groups, unlocated, activeKey: regionTarget.active.value } : undefined
})
const focusRegions = computed(() => {
  const regions = selectedRegions.value
  if (!regions)
    return undefined
  const { groups, unlocated } = invoiceRegionFocus(INVOICE_RECOGNITION_FIELDS, regions, regionTarget.active.value)
  return { mode: 'focus' as const, groups, unlocated, activeKey: regionTarget.active.value, locatedKeys: Object.keys(regions) }
})
const draftLocatedKeys = computed(() => draftRegions.value?.groups.flatMap(group => group.keys))
const draftUnlocatedKeys = computed(() => draftRegions.value?.unlocated.map(field => field.key))
watch(draft, (next, previous) => {
  if (next?.id !== previous?.id || next?.recognized !== previous?.recognized)
    regionTarget.reset()
})
watch(selectedId, () => regionTarget.reset())

async function confirmSelected() {
  if (!selectedId.value || !await saveDraftIfAny())
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
  if (!selectedId.value || !await saveDraftIfAny())
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
async function runRecognition(run: Promise<{ done: number, failed: number }>, label: string, ids: string[]) {
  const r = await promise(run, {
    loading: `${label}…`,
    success: ({ done }) => `已识别 ${done} 张`,
    error: () => '识别过程出错',
  })
  if (r.failed > 0) {
    const firstError = ids.map(id => store.recognitionError(id)).find(Boolean)
    warning(firstError
      ? `${r.failed} 张未完成识别：${firstError}`
      : `${r.failed} 张未完成识别（已归档或正在识别），可稍后重试`)
  }
}

async function handleUpload(files: File[] | FileList | null) {
  const picked = Array.from(files ?? []).filter(f => isRecognizableFile(f.name))
  if (!picked.length) {
    warning('请选择 PDF / 图片文件')
    return
  }
  // 先建行并立刻选中第一张（识别进度就地可见）；识别完成后不再回头改选中，
  // 避免用户批量期间点开别的票校对时被抢走上下文
  const ids = await store.uploadInvoices(picked)
  // 有未保存的识别结果时不抢走当前选中（切换须先保存或放弃）
  if (!draft.value)
    selectedId.value = ids[0]!
  await runRecognition(store.recognizeMany(ids), `识别 ${ids.length} 张上传发票`, ids)
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
  await runRecognition(store.recognizeMany(ids), `批量识别 ${ids.length} 张`, ids)
}

function editDraft(patch: Partial<Invoice>) {
  if (draft.value)
    draft.value = { ...draft.value, edits: { ...draft.value.edits, ...patch } }
}

/** 存在草稿时先确认放弃；无草稿直接放行。 */
async function confirmDiscardDraft(message = '重新识别结果尚未保存，确认放弃并保留识别前的值？') {
  if (!draft.value)
    return true
  const current = draft.value
  const ok = await confirm({ variant: 'simple', title: '放弃识别结果', message, confirmLabel: '放弃识别结果' })
  if (ok && draft.value === current)
    draft.value = null
  return ok
}

/** 保存草稿：二次确认列出变动 → 识别结果与人工修改分两次留痕写库。取消返回 false，草稿保留。 */
async function saveDraftIfAny() {
  const current = draft.value
  if (!current || current.id !== selectedId.value)
    return true
  const ok = await confirm({
    variant: 'simple',
    title: '保存重新识别结果',
    message: invoiceRecognitionSaveMessage(draftChanges.value),
    confirmLabel: '确认保存',
  })
  if (!ok || draft.value !== current)
    return false
  try {
    const logId = await store.saveRecognitionDraft(current.id, current.recognized, current.edits)
    if (!logId) {
      warning('保存失败：发票不存在或已删除')
      return false
    }
    draft.value = null
    return true
  }
  catch (cause) {
    warning(cause instanceof Error ? cause.message : '保存失败，请重试')
    return false
  }
}

async function handleSaveDraft() {
  if (await saveDraftIfAny())
    success('已保存重新识别结果，请重新校对')
}

async function handleRerecognize() {
  const id = selectedId.value
  if (!id)
    return
  // 待识别/识别失败的票走首次识别，结果直接写入（无可对照的原值）
  if (store.byId(id)?.ocrStatus !== 'done') {
    const ok = await promise(store.startRecognition(id), {
      loading: '重新识别中…',
      success: result => result ? '识别完成，请校对' : '识别未完成',
      error: () => '识别失败',
    })
    if (!ok)
      warning(store.recognitionError(id) || '无法重新识别：该票已归档或正在识别中')
    return
  }
  if (draft.value && !await confirmDiscardDraft('当前还有未保存的重新识别结果，再次识别将放弃它，确认继续？'))
    return
  const recognized = await promise(store.recognizeDraft(id), {
    loading: '重新识别中…',
    success: result => result ? '识别完成，结果未保存，请核对后保存' : '识别未完成',
    error: () => '识别失败',
  })
  if (!recognized) {
    warning(store.recognitionError(id) || '无法重新识别：该票已归档或正在识别中')
    return
  }
  const before = store.byId(id)
  if (!before)
    return
  if (selectedId.value !== id) {
    info('已切换到其他发票，本次重新识别结果未采用')
    return
  }
  draft.value = { id, before: { ...before }, recognized, edits: {} }
}

// 选中切换走离开保护：有草稿时先确认放弃
const selectedModel = computed({
  get: () => selectedId.value,
  set: (next: string | null) => {
    void selectInvoice(next)
  },
})
async function selectInvoice(next: string | null) {
  if (next === selectedId.value || !await confirmDiscardDraft())
    return
  selectedId.value = next
}

async function canLeave() {
  return confirmDiscardDraft()
}
useTabCloseGuard(canLeave)
onBeforeRouteLeave(canLeave)

// 草稿所属票被删除/归档（如其他页签操作）后草稿失效
watch(() => draft.value && store.byId(draft.value.id), (inv) => {
  if (draft.value && (!inv || inv.accountStatus === 'archived'))
    draft.value = null
})

// ── 批量通过(#63)：全绿票(建议通过池)一次放行——有归属的确认+归档,缺归属的排除并列清单 ──

const batchPassing = shallowRef(false)

async function handleBatchPass() {
  if (batchPassing.value || !store.suggestPass.length)
    return
  if (draft.value) {
    warning('请先保存或放弃当前未保存的重新识别结果，再批量通过')
    return
  }
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
  if (draft.value?.id === inv.id)
    draft.value = null
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
const WORKSPACE_STATUS_DOT_CLS: Record<InvoiceDocStatus, string> = {
  recognizing: 'bg-brand',
  pending: 'bg-warn',
  failed: 'bg-danger',
  duplicate: 'bg-danger',
  unreviewed: 'bg-warn',
  reviewed: 'bg-ok',
}
const workspaceRows = computed(() =>
  store.documents
    .filter(inv => inv.accountStatus === 'none')
    .map((inv) => {
      const progress = store.recognitionProgress[inv.id]
      const status = invoiceDocStatus(inv, progress != null)
      const tiers = Object.values(inv.fieldConfidence).map(confidenceTier)
      const confidence = tiers.includes('danger') ? 'danger' : tiers.includes('warn') ? 'warn' : 'ok'
      // #63:全绿待校对票标「建议通过」(只标记不自动归档,人工点批量通过放行)
      if (status === 'unreviewed' && isAllGreen(inv.fieldConfidence))
        return { inv, label: '建议通过', cls: 'chip-ok', dotCls: 'bg-ok', status, confidence, suggested: true }
      return {
        inv,
        label: status === 'recognizing' ? `识别中 ${progress}%` : WORKSPACE_STATUS_LABEL[status],
        cls: WORKSPACE_STATUS_CLS[status],
        dotCls: WORKSPACE_STATUS_DOT_CLS[status],
        status,
        confidence,
        suggested: false,
      }
    }),
)

const visibleWorkspaceRows = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  return workspaceRows.value.filter(({ inv, status, suggested, confidence }) => {
    // 有未保存识别结果的票始终保留在列表中，避免筛选把它挤掉后静默切换选中
    if (inv.id === draft.value?.id)
      return true
    const matchesFilter = !workspaceFilter.value.length
      || (workspaceFilter.value.includes('recognizing') && status === 'recognizing')
      || (workspaceFilter.value.includes('suggested') && suggested)
      || (workspaceFilter.value.includes('warning') && !suggested && status === 'unreviewed' && confidence === 'warn')
      || (workspaceFilter.value.includes('danger') && !suggested && status === 'unreviewed' && confidence === 'danger')
    if (!matchesFilter)
      return false
    if (!keyword)
      return true
    return [inv.invoiceNumber, inv.fileName, inv.seller, inv.buyer]
      .some(value => value?.toLowerCase().includes(keyword))
  })
})

const printableInvoices = computed(() => visibleWorkspaceRows.value.map(row => row.inv))

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

watch(visibleWorkspaceRows, (rows) => {
  if (!rows.some(({ inv }) => inv.id === selectedId.value))
    selectedId.value = rows[0]?.inv.id ?? null
}, { immediate: true })

onMounted(() => {
  store.load()
  projectStore.load()
})
</script>

<template>
  <div ref="pageRef" class="relative isolate">
    <!-- 全页拖拽虚线遮罩（#60：拖入即上传进识别队列；「+ 上传发票」走 useFileDialog 无需宿主元素） -->
    <div
      v-if="isOverDropZone"
      class="absolute inset-0 z-[var(--z-page-mask)] flex items-center justify-center border-2 border-dashed border-brand bg-brand-soft/40 pointer-events-none"
    >
      <div class="text-center">
        <span class="i-lucide-file-down text-32px text-brand block mx-auto mb-2" />
        <p class="text-14px font-700 text-brand-deep">
          松开上传发票，自动进入识别队列
        </p>
      </div>
    </div>

    <InvoiceWorkspaceToolbar
      v-model:mode="workspaceMode"
      :total="workspaceRows.length"
      :pending-count="pendingCount"
      :suggested-count="store.suggestPass.length"
      :recognizing="recognizing"
      :batch-passing="batchPassing"
      @add="showAddDialog = true"
      @recognize="handleBatchRecognize"
      @pass="handleBatchPass"
    />

    <!-- #60 单一校对工作台：宽屏三栏；窄容器分段但保留三个面板实例与编辑状态。 -->
    <AdaptiveWorkbench
      v-model="activePane"
      :labels="paneLabels"
    >
      <template #queue>
        <InvoiceQueuePanel
          v-model:search="searchText"
          v-model:filter="workspaceFilter"
          v-model:selected-id="selectedModel"
          :rows="visibleWorkspaceRows"
          :total="workspaceRows.length"
          :pending-review="store.pendingReview.length"
          @upload="openFilePicker()"
        />
      </template>

      <template #source>
        <InvoiceOriginalPanel
          v-if="workspaceMode === 'review'"
          :invoice="selectedInvoice"
          :file="selectedFile"
          :regions="draftRegions ?? focusRegions"
        />
        <InvoicePrintLayout
          v-else
          v-model:selected-id="selectedModel"
          :invoices="printableInvoices"
          :print-confirmation="pendingPrint"
          @print="handlePrint"
          @confirm-print="confirmPrint"
          @cancel-print="cancelPrint"
        />
      </template>

      <template #review>
        <div class="panel h-full min-w-0 w-full overflow-y-auto">
          <div class="border-b border-line bg-surface-2 px-3 py-2.5 text-12px font-700 text-ink">
            识别结果提取
          </div>
          <!-- 进度优先于表单：重新识别时(ocrStatus 仍是 done)也要显示识别中而非旧字段 -->
          <template v-if="selectedInvoice">
            <div v-if="store.recognitionProgress[selectedInvoice.id] != null" class="p-6 text-center text-12px">
              <span class="i-lucide-loader-circle animate-spin text-20px text-brand block mx-auto mb-2" />
              <span class="text-brand font-600">识别中 {{ store.recognitionProgress[selectedInvoice.id] }}%</span>
            </div>
            <div v-else-if="selectedInvoice.ocrStatus === 'done'" class="p-3">
              <InvoiceRecognitionChanges
                v-if="draftSelected"
                class="mb-3"
                :changes="draftChanges"
                save-label="保存识别结果"
                :unlocated-keys="draftUnlocatedKeys"
                @discard="confirmDiscardDraft()"
                @save="handleSaveDraft"
                @locate="regionTarget.locate"
                @preview="regionTarget.preview"
              />
              <InvoiceReviewForm
                :invoice="draftSelected && draftValues ? draftValues : selectedInvoice"
                :draft="draftSelected"
                :marks="draftSelected ? draftMarks : undefined"
                :located-keys="draftLocatedKeys"
                :focus-located-keys="focusRegions?.locatedKeys"
                @edit="editDraft"
                @locate="regionTarget.locate"
                @preview="regionTarget.preview"
                @release="regionTarget.release"
                @confirm="confirmSelected"
                @archive="archiveSelected"
                @discard="handleDiscard"
                @rerecognize="handleRerecognize"
              />
            </div>
            <div v-else-if="selectedInvoice.ocrStatus === 'failed'" class="p-6 text-center text-12px">
              <span class="i-lucide-circle-alert text-20px text-danger block mx-auto mb-2" />
              <p class="mb-3 text-danger">
                {{ store.recognitionError(selectedInvoice.id) || '识别失败，请检查服务后重试' }}
              </p>
              <button type="button" class="btn-secondary" @click="handleRerecognize">
                重新识别
              </button>
            </div>
            <div v-else class="p-6 text-center text-12px">
              <span class="text-ink-faint">待识别——点击顶部「批量识别」开始</span>
            </div>
          </template>
          <div v-else class="p-4 text-center text-ink-faint text-12px">
            选择一张发票开始校对
          </div>
        </div>
      </template>
    </AdaptiveWorkbench>

    <InvoiceManualEntryDialog v-model:open="showAddDialog" />
  </div>
</template>
