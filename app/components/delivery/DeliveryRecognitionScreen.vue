<script setup lang="ts">
import type { DeliveryReviewInput } from '~/stores/delivery'
import { matchProjectText, matchSupplierName } from '~/lib/delivery/match'
import { isRecognizableFile, RECOGNIZABLE_FILE_ACCEPT } from '~/lib/invoice/recognize'
import { round2 } from '~/lib/util/number'

const store = useDeliveryStore()
const projectStore = useProjectStore()
const supplierStore = useSupplierStore()
const { confirm, promise, warning } = useKitUI()

const pageRef = useTemplateRef<HTMLElement>('pageRef')
const selectedFileId = shallowRef<string | null>(null)
const selectedDocumentId = shallowRef<string | null>(null)
const reviewDraft = ref<DeliveryReviewInput | null>(null)
const saving = shallowRef(false)
const previewUrls = shallowReactive(new Map<string, string>())

const selectedFile = computed(() => selectedFileId.value ? store.byId(selectedFileId.value) : undefined)
const selectedDocument = computed(() => selectedFile.value?.docs.find(doc => doc.id === selectedDocumentId.value))

const supplierSuggestion = computed(() => {
  const source = selectedDocument.value?.supplierText || selectedFile.value?.supplierText || ''
  return matchSupplierName(source, supplierStore.list.map(supplier => ({
    id: supplier.id,
    name: supplier.name,
    aliases: supplier.aliases,
  })))
})

const projectSuggestion = computed(() => {
  const document = selectedDocument.value
  const file = selectedFile.value
  if (!document || !file)
    return null
  return matchProjectText(
    [document.siteText, file.name],
    projectStore.list.map(project => ({ id: project.id, name: project.name })),
  )
})

function selectFile(id: string) {
  selectedFileId.value = id
  selectedDocumentId.value = store.byId(id)?.docs[0]?.id ?? null
}

function selectDocument(id: string) {
  selectedDocumentId.value = id
}

function ensureSelection() {
  const currentFile = selectedFileId.value ? store.byId(selectedFileId.value) : undefined
  if (!currentFile) {
    selectedFileId.value = store.files[0]?.id ?? null
    selectedDocumentId.value = store.files[0]?.docs[0]?.id ?? null
    return
  }
  if (!currentFile.docs.some(doc => doc.id === selectedDocumentId.value))
    selectedDocumentId.value = currentFile.docs[0]?.id ?? null
}

watch(() => store.files, ensureSelection, { immediate: true })

watch([
  selectedDocument,
  () => projectStore.list,
  () => supplierStore.list,
], ([document]) => {
  if (!document) {
    reviewDraft.value = null
    return
  }
  reviewDraft.value = {
    projectId: projectSuggestion.value?.id ?? '',
    supplierId: supplierSuggestion.value?.id ?? null,
    orderNo: document.orderNo,
    deliveryDate: document.deliveryDate,
    siteText: document.siteText,
    docType: document.docType,
    note: document.note,
    items: document.items.map(item => ({ ...item })),
  }
}, { immediate: true })

watch(() => store.files.map(file => file.id), (liveIds) => {
  const live = new Set(liveIds)
  for (const [id, url] of previewUrls) {
    if (live.has(id))
      continue
    URL.revokeObjectURL(url)
    previewUrls.delete(id)
  }
})

const { open: openFilePicker, onChange: onFilesPicked } = useFileDialog({
  multiple: true,
  accept: RECOGNIZABLE_FILE_ACCEPT,
  reset: true,
})
onFilesPicked(files => handleUpload(files))

async function runRecognition(ids: string[], label: string) {
  const result = await promise(store.recognizeMany(ids), {
    loading: `${label}…`,
    success: ({ done }) => `已识别 ${done} 个文件`,
    error: caught => caught instanceof Error ? caught.message : '送货单识别失败',
  })
  if (result.failed) {
    const reason = ids.map(id => store.byId(id)?.ocrError).find(Boolean)
    warning(`${result.failed} 个文件未完成识别${reason ? `：${reason}` : ''}`)
  }
}

async function handleUpload(files: File[] | FileList | null) {
  const picked = Array.from(files ?? []).filter(file => isRecognizableFile(file.name))
  if (!picked.length) {
    warning('请选择 PDF、PNG、JPG 或 JPEG 文件')
    return
  }
  const ids = store.uploadFiles(picked)
  ids.forEach((id, index) => {
    const file = picked[index]
    if (file)
      previewUrls.set(id, URL.createObjectURL(file))
  })
  selectFile(ids[0]!)
  await runRecognition(ids, `识别 ${ids.length} 个送货文件`)
}

const { isOverDropZone } = useDropZone(pageRef, {
  onDrop: files => handleUpload(files),
})

async function recognizeOne(id?: string) {
  const fileId = id ?? selectedFileId.value
  if (!fileId)
    return
  const ok = await promise(store.recognizeFile(fileId), {
    loading: 'PaddleOCR-VL 识别中…',
    success: result => result ? '识别完成，请核对' : '识别未完成',
    error: caught => caught instanceof Error ? caught.message : '识别失败',
  })
  if (!ok)
    warning(store.byId(fileId)?.ocrError || '识别未完成，请稍后重试')
}

async function recognizeAll() {
  const ids = store.pendingFiles.map(file => file.id)
  if (!ids.length) {
    warning('没有待识别文件')
    return
  }
  await runRecognition(ids, `批量识别 ${ids.length} 个文件`)
}

async function removeFile(id: string) {
  const file = store.byId(id)
  if (!file)
    return
  const ok = await confirm({
    variant: 'simple',
    title: '移出识别队列',
    message: `确认移出「${file.name}」？尚未归档的识别结果会丢失。`,
    confirmLabel: '移出',
  })
  if (ok)
    store.removeFile(id)
}

async function archiveSelected() {
  const file = selectedFile.value
  const document = selectedDocument.value
  const draft = reviewDraft.value
  if (!file || !document || !draft || saving.value)
    return
  if (!draft.projectId) {
    warning('核对完成前必须选择所属项目')
    return
  }
  const validItems = draft.items
    .filter(item => item.name.trim())
    .map(item => ({
      ...item,
      amount: round2(Number(item.qty || 0) * Number(item.unitPrice || 0)),
    }))
  if (!validItems.length) {
    warning('至少保留一条材料明细')
    return
  }

  const cautions: string[] = []
  if (!draft.supplierId)
    cautions.push('分供方将归到“未区分分供方”')
  if (!draft.deliveryDate)
    cautions.push('缺少送货日期')
  if (!draft.orderNo && draft.docType !== '收据')
    cautions.push('缺少送货单号')
  if (!document.balanced)
    cautions.push('票面合计与当前材料明细尚未勾稽')
  if (cautions.length) {
    const ok = await confirm({
      variant: 'simple',
      title: '带提醒完成核对',
      message: `${cautions.map(item => `· ${item}`).join('\n')}\n\n仍要完成核对并自动归档吗？`,
      confirmLabel: '继续归档',
    })
    if (!ok)
      return
  }

  saving.value = true
  try {
    const input: DeliveryReviewInput = { ...draft, items: validItems }
    await promise(store.archiveDocument(file.id, document.id, input), {
      loading: '正在归档送货单…',
      success: '已完成核对并进入归档库',
      error: caught => caught instanceof Error ? caught.message : '送货单归档失败',
    })
    ensureSelection()
  }
  catch {
    // promise toast 已展示具体失败原因；保留当前草稿继续修正。
  }
  finally {
    saving.value = false
  }
}

onMounted(() => {
  Promise.all([projectStore.load(), supplierStore.load()])
})

onScopeDispose(() => {
  for (const url of previewUrls.values())
    URL.revokeObjectURL(url)
})
</script>

<template>
  <div ref="pageRef" class="relative flex min-w-0 flex-col gap-3">
    <div
      v-if="isOverDropZone"
      class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed border-brand bg-brand-soft/80"
    >
      <div class="text-center text-brand-deep">
        <span class="i-lucide-file-down mx-auto mb-2 block text-32px" />
        <p class="text-14px font-800">
          松开后上传并自动识别
        </p>
      </div>
    </div>

    <div class="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-panel px-4 py-3 shadow-[var(--shadow-card)]">
      <div>
        <div class="text-16px font-800 text-ink">
          送货单识别工作台
        </div>
        <div class="mt-0.5 text-11px text-ink-faint">
          PaddleOCR-VL 1.6 · 方向矫正 · 表格提取 · 人工核对后自动归档
        </div>
      </div>
      <div class="flex-1" />
      <button type="button" class="btn-secondary" :disabled="!store.pendingFiles.length" @click="recognizeAll">
        <span class="i-lucide-scan-text mr-1 text-12px" />识别全部（{{ store.pendingFiles.length }}）
      </button>
      <button type="button" class="btn-primary" @click="openFilePicker()">
        <span class="i-lucide-upload mr-1 text-12px" />上传送货单
      </button>
    </div>

    <button
      type="button"
      class="flex items-center justify-center gap-3 rounded-[var(--radius-card)] border border-dashed border-brand/55 bg-brand-soft/25 px-4 py-3 text-left transition-colors hover:bg-brand-soft/55"
      @click="openFilePicker()"
    >
      <span class="i-lucide-folder-up text-20px text-brand" />
      <span>
        <b class="block text-12px text-ink">拖拽或点击上传 PDF / 图片</b>
        <span class="text-10px text-ink-faint">支持 PDF、PNG、JPG、JPEG；文件仅在当前识别会话保留</span>
      </span>
    </button>

    <div class="grid grid-cols-4 gap-3">
      <StatCard label="队列文件" :value="store.stats.total" icon="i-lucide-files" color="brand" />
      <StatCard label="待识别" :value="store.stats.pending" icon="i-lucide-clock" color="warn" />
      <StatCard label="待核对" :value="store.stats.done" icon="i-lucide-file-check" color="ok" />
      <StatCard label="识别失败" :value="store.stats.failed" icon="i-lucide-circle-x" color="danger" />
    </div>

    <div class="flex min-h-155 gap-3" style="height: calc(100vh - 330px)">
      <DeliveryQueuePanel
        :files="store.files"
        :selected-id="selectedFileId"
        :progress="store.recognitionProgress"
        @select="selectFile"
        @upload="openFilePicker()"
        @recognize="recognizeOne"
        @remove="removeFile"
      />
      <div class="min-w-0 basis-[38%]">
        <DeliveryOriginalPanel :file="selectedFile" :preview-url="selectedFileId ? previewUrls.get(selectedFileId) : undefined" />
      </div>
      <div class="min-w-0 flex-1">
        <DeliveryReviewPanel
          v-model="reviewDraft"
          :file="selectedFile"
          :document="selectedDocument"
          :documents="selectedFile?.docs ?? []"
          :projects="projectStore.list"
          :suppliers="supplierStore.list"
          :supplier-suggestion="supplierSuggestion"
          :saving="saving"
          @select-document="selectDocument"
          @recognize="recognizeOne()"
          @archive="archiveSelected"
        />
      </div>
    </div>
  </div>
</template>
