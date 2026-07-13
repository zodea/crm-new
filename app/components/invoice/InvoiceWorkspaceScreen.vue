<script setup lang="ts">
import type { InvoiceDocStatus } from '~/lib/invoice/status'
import { isAllGreen, resolveAttribution } from '~/lib/invoice/batch-pass'
import { confidenceTier, isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'
import { invoiceDocStatus } from '~/lib/invoice/status'

const store = useInvoiceStore()
const projectStore = useProjectStore()
const { success, warning, info, undoToast, confirm, promise } = useKitUI()

// #60：单一校对工作台，上传、识别状态与字段校对在同一上下文完成。
const searchText = shallowRef('')
const workspaceFilter = shallowRef<'all' | 'recognizing' | 'suggested' | 'warning' | 'danger'>('all')
const selectedId = shallowRef<string | null>(null)

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
const previewUrls = shallowReactive(new Map<string, string>())

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
  // 先建行并立刻选中第一张（识别进度就地可见）；识别完成后不再回头改选中，
  // 避免用户批量期间点开别的票校对时被抢走上下文
  const ids = await store.uploadInvoices(picked.map(f => ({ name: f.name, size: f.size })))
  ids.forEach((id, index) => {
    const file = picked[index]
    if (file)
      previewUrls.set(id, URL.createObjectURL(file))
  })
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

const batchPassing = shallowRef(false)

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
    const matchesFilter = workspaceFilter.value === 'all'
      || (workspaceFilter.value === 'recognizing' && status === 'recognizing')
      || (workspaceFilter.value === 'suggested' && suggested)
      || (workspaceFilter.value === 'warning' && !suggested && status === 'unreviewed' && confidence === 'warn')
      || (workspaceFilter.value === 'danger' && !suggested && status === 'unreviewed' && confidence === 'danger')
    if (!matchesFilter)
      return false
    if (!keyword)
      return true
    return [inv.invoiceNumber, inv.fileName, inv.seller, inv.buyer]
      .some(value => value?.toLowerCase().includes(keyword))
  })
})

watch(visibleWorkspaceRows, (rows) => {
  if (!rows.some(({ inv }) => inv.id === selectedId.value))
    selectedId.value = rows[0]?.inv.id ?? null
}, { immediate: true })

onScopeDispose(() => {
  for (const url of previewUrls.values())
    URL.revokeObjectURL(url)
})

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

    <InvoiceWorkspaceToolbar
      :total="workspaceRows.length"
      :pending-count="pendingCount"
      :suggested-count="store.suggestPass.length"
      :recognizing="recognizing"
      :batch-passing="batchPassing"
      @add="showAddDialog = true"
      @recognize="handleBatchRecognize"
      @pass="handleBatchPass"
    />

    <!-- #60 单一校对工作台：左队列 / 中原图 / 右字段 -->
    <div class="flex gap-3.5" style="height: calc(100vh - 220px); min-height: 560px">
      <InvoiceQueuePanel
        v-model:search="searchText"
        v-model:filter="workspaceFilter"
        v-model:selected-id="selectedId"
        :rows="visibleWorkspaceRows"
        :total="workspaceRows.length"
        :pending-review="store.pendingReview.length"
        @upload="openFilePicker()"
      />

      <InvoiceOriginalPanel
        :invoice="selectedInvoice"
        :preview-url="selectedId ? previewUrls.get(selectedId) : undefined"
      />

      <!-- 右栏 — 识别结果校对（字段表） -->
      <div class="basis-[42%] min-w-0 overflow-y-auto border border-line rounded-[var(--radius-card)] bg-panel shadow-[var(--shadow-card)]">
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

    <InvoiceManualEntryDialog v-model:open="showAddDialog" />
  </div>
</template>
